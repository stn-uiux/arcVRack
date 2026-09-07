import { useState, useEffect, useMemo, useRef, useCallback, forwardRef, Suspense, memo, useDeferredValue } from "react";
import { useTexture, Billboard, Html, Edges } from "@react-three/drei";
import { type ThreeEvent, useThree, useFrame } from "@react-three/fiber";
import { BoxGeometry, CanvasTexture, Color, DoubleSide, Euler, Mesh, MeshStandardMaterial, Object3D, Plane, RepeatWrapping, Vector3, Group, MathUtils } from 'three';
import { useStore } from "../../store/useStore";
import { getEffectiveCards } from "../../utils/sampleUtils";
import type { AppState } from "../../store/useStore";
import { useTheme } from "../../contexts/ThemeContext";
import type { Rack as RackType, Device } from "../../types";
import { ErrorMarker } from "./ErrorMarker";
import { U_HEIGHT, GRID_SPACING, DEVICE_DEPTH } from "../layout/constants";
import { getHighestError } from "../../utils/errorHelpers";
import { resolveDeviceImage, isChassisModel } from "../../utils/deviceAssets";
import { DEFAULT_CHASSIS_CARDS } from "../../utils/defaultChassisCards";

// ─── Phase 1-A: 모듈 레벨 공유 Geometry (모든 Rack이 재사용) ───
const SHARED_GEO = {
  topBottom: new BoxGeometry(1, 0.03, 1),
  cornerPost: new BoxGeometry(0.02, 1, 0.02),
  hBrace: new BoxGeometry(1, 0.02, 0.02),
  frontRail: new BoxGeometry(0.03, 1, 0.03),
  backRail: new BoxGeometry(0.02, 1, 0.02),
  rearBezel: new BoxGeometry(1, 1, 0.01),
  doorHBar: new BoxGeometry(1, 0.04, 0.02),
  doorVBar: new BoxGeometry(0.04, 1, 0.02),
  interactBox: new BoxGeometry(1, 1, 1),
};

// ─── Phase 1-B: perforatedTexture 모듈 레벨 캐시 ───
const _perforatedCache = new Map<number, CanvasTexture>();
function getPerforatedTexture(rackSize: number): CanvasTexture {
  if (_perforatedCache.has(rackSize)) return _perforatedCache.get(rackSize)!;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "black";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  const density = 40;
  const panelW = 1.0 - 0.04;
  const panelH = rackSize * U_HEIGHT + 0.1 - 0.06;
  const railV = 0.08;
  const railW = 0.08;
  const innerW = panelW - railV * 2;
  const innerH = panelH - railW * 2;
  tex.repeat.set(innerW * density, innerH * density);
  _perforatedCache.set(rackSize, tex);
  return tex;
}

// Snapshot of selectedRackId captured inside handlePointerDown BEFORE selectRack()
// mutates it. Since the Interaction Layer is geometrically closer to the camera,
// handlePointerDown fires FIRST, then DeviceMesh's onClick fires and reads this.
let selectedRackIdBeforePointerDown: string | null = null;

type RackProps = RackType;

export const Rack = memo(({
  rackId,
  rackTitle,
  rackSize,
  width: rackWidth,
  position,
  devices,
  mapId,
  orientation: orientationProp,
}: RackProps) => {
  // Boolean selectors: only re-render when THIS rack's selection state changes
  const isSelected = useStore((state: AppState) => state.selectedRackId === rackId);
  const isHovered = useStore((state: AppState) => state.hoveredRackId === rackId);
  const isFocused = useStore((state: AppState) => state.focusedRackId === rackId);
  const isObstructing = useStore((state: AppState) => state.obstructingRackIds.includes(rackId));
  const isEditMode = useStore((state: AppState) => state.isEditMode);
  const { theme } = useTheme();

  const isInternalFocused = isSelected || isFocused;

  // Local subscription for drag state to prevent global re-renders
  const isInternalDragging = useStore((state: AppState) => state.draggingRackId === rackId);
  const dragPosition = useStore((state: AppState) => state.draggingRackId === rackId ? state.dragPosition : null);

  const isDarkMode = theme === "dark";
  // Use orientation from props directly instead of searching store.racks
  const orientation = orientationProp ?? 180;

  const { raycaster, mouse, camera } = useThree();
  const floorPlane = useMemo(
    () => new Plane(new Vector3(0, 1, 0), 0),
    [],
  );
  const tempPoint = useMemo(() => new Vector3(), []);

  // Phase 1-B: 캐시된 perforatedTexture 사용
  const perforatedTexture = useMemo(() => getPerforatedTexture(rackSize), [rackSize]);

  const height = rackSize * U_HEIGHT + 0.1;
  const width = rackWidth;
  const depth = 1.0;

  // Theme-based colors
  const frameColor = isSelected
    ? "#FFFFFF" // White highlight for both modes
    : isDarkMode
      ? "#2e313b" // Darker than background
      : "#333333";
  const railColor = isDarkMode ? "#aab0be" : "#888";
  const rearPanelColor = isDarkMode ? "#24272e" : "#111";

  // Convert orientation to radians with proper mapping:
  // North (0°) should face -Z world (180° rotation)
  // East (90°) should face +X world (90° rotation)
  // South (180°) should face +Z world (0° rotation)
  // West (270°) should face -X world (270° rotation)
  // Formula: (180 - orientation)
  const rotationRad = ((180 - (orientation ?? 0)) * Math.PI) / 180;

  const groupRef = useRef<Group>(null);
  const doorRef = useRef<Group>(null);
  const isFirstRender = useRef(true);

  // Declarative animation - Purely reactive to props/state
  const currentTargetPos = useMemo(() =>
    isInternalDragging && dragPosition
      ? [dragPosition[0], height / 2 + 0.4, dragPosition[1]]
      : [position[0] * GRID_SPACING, height / 2, position[1] * GRID_SPACING]
    , [isInternalDragging, dragPosition, position, height]);

  useFrame((_, delta) => {
    // 1. First-frame direct sync to prevent visible jump/slide on mount
    if (isFirstRender.current) {
      if (groupRef.current) {
        groupRef.current.position.set(currentTargetPos[0], currentTargetPos[1], currentTargetPos[2]);
        groupRef.current.rotation.y = rotationRad;
        groupRef.current.scale.setScalar(1);
      }
      if (doorRef.current) {
        doorRef.current.rotation.y = isInternalFocused ? -Math.PI / 2 : 0;
      }
      isFirstRender.current = false;
      return;
    }

    // 2. groupRef animation interpolation
    if (groupRef.current) {
      if (isInternalDragging) {
        groupRef.current.position.set(currentTargetPos[0], currentTargetPos[1], currentTargetPos[2]);
        groupRef.current.scale.setScalar(1.05);
      } else {
        groupRef.current.position.x = MathUtils.damp(groupRef.current.position.x, currentTargetPos[0], 12, delta);
        groupRef.current.position.y = MathUtils.damp(groupRef.current.position.y, currentTargetPos[1], 12, delta);
        groupRef.current.position.z = MathUtils.damp(groupRef.current.position.z, currentTargetPos[2], 12, delta);

        groupRef.current.scale.x = MathUtils.damp(groupRef.current.scale.x, 1, 12, delta);
        groupRef.current.scale.y = MathUtils.damp(groupRef.current.scale.y, 1, 12, delta);
        groupRef.current.scale.z = MathUtils.damp(groupRef.current.scale.z, 1, 12, delta);
      }
      groupRef.current.rotation.y = MathUtils.damp(groupRef.current.rotation.y, rotationRad, 12, delta);
    }

    // 3. doorRef animation interpolation
    if (doorRef.current) {
      const targetDoorRotation = isInternalFocused ? -Math.PI / 2 : 0;
      doorRef.current.rotation.y = MathUtils.damp(doorRef.current.rotation.y, targetDoorRotation, 8, delta);
    }
  });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return; // Only process left click
    if (isObstructing) return;

    // Ignore pointer events if the user is interacting with the dashboard Gizmo
    if (useStore.getState().isGizmoHovered) return;

    // 1. GIZMO PRIORITY: Because PivotControls has depthTest={false}, it's visually always on top.
    // If the ray hits a Gizmo anywhere, the user intended to click it.
    const hitGizmo = e.intersections.some((hit) => {
      let obj: Object3D | null = hit.object;
      let isInner = false;
      let isGizmo = false;
      while (obj) {
        if (obj.userData?.isInnerContent) isInner = true;
        if (obj.userData?.isGizmo || obj.userData?.isGizmoHelper) isGizmo = true;
        obj = obj.parent;
      }
      return isGizmo && !isInner;
    });

    if (hitGizmo) return; // Yield to gizmo immediately

    // 2. MODEL PRIORITY: Determine if the raycaster intersected an ImportedModel BEFORE hitting a solid rack part
    let hitModel = false;
    for (const hit of e.intersections) {
      let isModel = false;
      let obj: Object3D | null = hit.object;
      while (obj) {
        if (obj.userData && obj.userData.isModelContainer) {
          isModel = true;
          break;
        }
        obj = obj.parent;
      }

      if (isModel) {
        hitModel = true;
        break;
      }

      // If we hit a SOLID part of a Rack or Device BEFORE hitting a model,
      // it means the model is hidden behind the rack.
      // We skip SHARED_GEO.interactBox because it is an invisible bounding box.
      if ((hit.object as Mesh).geometry !== SHARED_GEO.interactBox) {
        break;
      }
    }

    if (hitModel) {
      // Do not stop propagation and do not select rack; let the model handle it.
      return;
    }

    e.stopPropagation();
    const { selectRack, setDragging, updateDragPosition, isEditMode } =
      useStore.getState();

    // Snapshot BEFORE mutation — DeviceMesh onClick reads this for two-step gate
    selectedRackIdBeforePointerDown = useStore.getState().selectedRackId;

    if (!isEditMode) return;

    // Use the camera we already have from the top-level useThree() hook
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(floorPlane, tempPoint)) {
      const rackWorldX = position[0] * GRID_SPACING;
      const rackWorldZ = position[1] * GRID_SPACING;

      // Offset = ClickedFloorPoint - RackCenter
      const offset: [number, number] = [
        tempPoint.x - rackWorldX,
        tempPoint.z - rackWorldZ,
      ];

      setDragging(true, rackId, offset);
      updateDragPosition([rackWorldX, rackWorldZ]);
      document.body.style.cursor = "grabbing";
    }
  };

  const setHoveredRack = useStore((state: AppState) => state.setHoveredRack);
  const isGlobalDragging = useStore((state: AppState) => state.isDragging);

  const initialPos = useMemo(() => [position[0] * GRID_SPACING, height / 2, position[1] * GRID_SPACING], [position, height]);
  const initialRot = useMemo(() => [0, rotationRad, 0], [rotationRad]);

  const racks = useStore((state: AppState) => state.racks);
  const nodeRacks = useMemo(() => racks.filter(r => r.mapId === mapId), [racks, mapId]);

  const snappedGhostPosition = useMemo(() => {
    if (!isInternalDragging || !dragPosition) return null;

    let gridX = dragPosition[0] / GRID_SPACING;
    let gridZ = dragPosition[1] / GRID_SPACING;

    const SNAP_THRESHOLD = 0.5;
    const worldX = dragPosition[0];
    const worldZ = dragPosition[1];
    let finalGridX = gridX;
    let finalGridZ = gridZ;

    let xSnapped = false;
    for (const other of nodeRacks) {
      if (other.rackId === rackId) continue;
      // X-axis snap
      if (Math.abs(other.position[1] - gridZ) <= 0.1) {
        const otherWorldX = other.position[0] * GRID_SPACING;
        const gap = Math.abs(worldX - otherWorldX) - (width + other.width) / 2;
        if (gap >= -0.1 && gap < SNAP_THRESHOLD) {
          const direction = worldX > otherWorldX ? 1 : -1;
          const RACK_GAP = 0.01;
          const snappedWorldX = otherWorldX + (direction * (other.width + width)) / 2 + (direction * RACK_GAP);
          finalGridX = snappedWorldX / GRID_SPACING;
          finalGridZ = other.position[1];
          xSnapped = true;
          break;
        }
      }
    }

    if (!xSnapped) {
      const RACK_D = 1.0;
      for (const other of nodeRacks) {
        if (other.rackId === rackId) continue;
        const otherWorldX = other.position[0] * GRID_SPACING;
        if (Math.abs(worldX - otherWorldX) > (width + other.width) / 2 + 0.1) continue;

        const otherWorldZ = other.position[1] * GRID_SPACING;
        const zGap = Math.abs(worldZ - otherWorldZ) - (RACK_D + RACK_D) / 2;
        if (zGap >= -0.1 && zGap < SNAP_THRESHOLD) {
          const direction = worldZ > otherWorldZ ? 1 : -1;
          const snappedWorldZ = otherWorldZ + (direction * (RACK_D + RACK_D)) / 2;
          finalGridZ = snappedWorldZ / GRID_SPACING;
          finalGridX = other.position[0];
          break;
        }
      }
    }

    return [finalGridX * GRID_SPACING, finalGridZ * GRID_SPACING];
  }, [isInternalDragging, dragPosition, nodeRacks, rackId, width]);

  return (
    <>
      {snappedGhostPosition && (
        <group position={[snappedGhostPosition[0], 0.005, snappedGhostPosition[1]]} rotation={[-Math.PI / 2, 0, rotationRad]}>
          <mesh>
            <planeGeometry args={[width, depth]} />
            <meshBasicMaterial color={isDarkMode ? "#ef4444" : "#dc2626"} transparent opacity={0.15} depthWrite={false} />
            <Edges scale={1.0} threshold={15} color={isDarkMode ? "#f87171" : "#ef4444"} />
          </mesh>
        </group>
      )}
      <group
        ref={groupRef}
        visible={!isObstructing}
        position={initialPos as unknown as Vector3}
        rotation={initialRot as unknown as Euler}
        scale={[1, 1, 1]}
      >
        {/* 1. STRUCTURAL FRAME (Main Skeleton) */}
        <group>
          {/* Main Enclosure (Solid frame with better corner joins) */}
          {/* Top */}
          <mesh position={[0, height / 2 - 0.015, 0]} geometry={SHARED_GEO.topBottom} scale={[width, 1, depth]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.6}
              metalness={0.9}
            />
          </mesh>
          {/* Bottom */}
          <mesh position={[0, -height / 2 + 0.015, 0]} geometry={SHARED_GEO.topBottom} scale={[width, 1, depth]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.6}
              metalness={0.9}
            />
          </mesh>
          {/* Left Side – corner posts only (no full-depth wall, so perforated holes reveal interior) */}
          <mesh position={[-width / 2 + 0.01, 0, depth / 2 - 0.01]} geometry={SHARED_GEO.cornerPost} scale={[1, height, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.6}
              metalness={0.9}
            />
          </mesh>
          <mesh position={[-width / 2 + 0.01, 0, -depth / 2 + 0.01]} geometry={SHARED_GEO.cornerPost} scale={[1, height, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.6}
              metalness={0.9}
            />
          </mesh>
          {/* Right Side – corner posts only */}
          <mesh position={[width / 2 - 0.01, 0, depth / 2 - 0.01]} geometry={SHARED_GEO.cornerPost} scale={[1, height, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.6}
              metalness={0.9}
            />
          </mesh>
          <mesh position={[width / 2 - 0.01, 0, -depth / 2 + 0.01]} geometry={SHARED_GEO.cornerPost} scale={[1, height, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.6}
              metalness={0.9}
            />
          </mesh>

          {/* ── LEFT SIDE PANEL ── */}
          <PerforatedPanel xOff={-width / 2} rotY={-Math.PI / 2} panelW={depth - 0.04} panelH={height - 0.06} color={frameColor} texture={perforatedTexture} />

          {/* ── RIGHT SIDE PANEL ── */}
          <PerforatedPanel xOff={width / 2} rotY={Math.PI / 2} panelW={depth - 0.04} panelH={height - 0.06} color={frameColor} texture={perforatedTexture} />

          <group position={[0, 0, 0]}>
            {/* Internal Structural Bracing - Horizontal rails at the back */}
            <mesh position={[0, height / 2 - 0.15, -depth / 2 + 0.1]} geometry={SHARED_GEO.hBrace} scale={[width - 0.04, 1, 1]}>
              <meshStandardMaterial color={frameColor} roughness={0.8} />
            </mesh>
            <mesh position={[0, -height / 2 + 0.15, -depth / 2 + 0.1]} geometry={SHARED_GEO.hBrace} scale={[width - 0.04, 1, 1]}>
              <meshStandardMaterial color={frameColor} roughness={0.8} />
            </mesh>

            {/* Vertical Mounting Rails (Front) */}
            <mesh position={[-width / 2 + 0.06, 0, depth / 2 - 0.12]} geometry={SHARED_GEO.frontRail} scale={[1, height - 0.08, 1]}>
              <meshStandardMaterial
                color={railColor}
                metalness={1}
                roughness={0.2}
              />
            </mesh>
            <mesh position={[width / 2 - 0.06, 0, depth / 2 - 0.12]} geometry={SHARED_GEO.frontRail} scale={[1, height - 0.08, 1]}>
              <meshStandardMaterial
                color={railColor}
                metalness={1}
                roughness={0.2}
              />
            </mesh>

            {/* Vertical Support Rails (Back) */}
            <mesh position={[-width / 2 + 0.06, 0, -depth / 2 + 0.12]} geometry={SHARED_GEO.backRail} scale={[1, height - 0.08, 1]}>
              <meshStandardMaterial color={railColor} roughness={0.5} />
            </mesh>
            <mesh position={[width / 2 - 0.06, 0, -depth / 2 + 0.12]} geometry={SHARED_GEO.backRail} scale={[1, height - 0.08, 1]}>
              <meshStandardMaterial color={railColor} roughness={0.5} />
            </mesh>
          </group>
        </group>

        {/* 2. REAR PANEL (Solid opaque plate – no perforation) */}
        <group position={[0, 0, -depth / 2 + 0.02]}>
          {/* Panel Bezel / Frame */}
          <mesh position={[0, 0, -0.005]} geometry={SHARED_GEO.rearBezel} scale={[width - 0.02, height - 0.04, 1]}>
            <meshStandardMaterial color={frameColor} roughness={0.7} />
          </mesh>
          {/* Solid Rear Plate */}
          <mesh position={[0, 0, 0.001]}>
            <planeGeometry args={[width - 0.08, height - 0.1]} />
            <meshStandardMaterial
              color={rearPanelColor}
              roughness={0.9}
              metalness={0.6}
              side={DoubleSide}
            />
          </mesh>
        </group>

        {/* 3. FRONT HINGED DOOR (Hollow Frame + Glass) */}
        <group
          ref={doorRef}
          position={[-width / 2, 0, depth / 2]} // Pivot at exact left edge
        >
          {/* Door Frame Border - Top */}
          <mesh position={[width / 2, height / 2 - 0.02, 0.01]} geometry={SHARED_GEO.doorHBar} scale={[width, 1, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.7}
              metalness={0.8}
            />
          </mesh>
          {/* Door Frame Border - Bottom */}
          <mesh position={[width / 2, -height / 2 + 0.02, 0.01]} geometry={SHARED_GEO.doorHBar} scale={[width, 1, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.7}
              metalness={0.8}
            />
          </mesh>
          {/* Door Frame Border - Left */}
          <mesh position={[0.02, 0, 0.01]} geometry={SHARED_GEO.doorVBar} scale={[1, height - 0.08, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.7}
              metalness={0.8}
            />
          </mesh>
          {/* Door Frame Border - Right */}
          <mesh position={[width - 0.02, 0, 0.01]} geometry={SHARED_GEO.doorVBar} scale={[1, height - 0.08, 1]}>
            <meshStandardMaterial
              color={frameColor}
              roughness={0.7}
              metalness={0.8}
            />
          </mesh>

          {/* Glass Center Panel - Optimized to MeshStandardMaterial */}
          <mesh position={[width / 2, 0, 0.01]}>
            <planeGeometry args={[width - 0.08, height - 0.08]} />
            <meshStandardMaterial
              transparent
              opacity={0.1}
              color="#000000"
              roughness={0}
              metalness={0.5}
            />
          </mesh>
        </group>

        <mesh
          geometry={SHARED_GEO.interactBox}
          scale={[width, height, depth]}
          onPointerDown={isObstructing ? undefined : handlePointerDown}
          onClick={isObstructing ? undefined : (e) => {
            if (e.delta > 15) return; // Ignore drag
            (e as any).stoppedByRack = true;

            const hitGizmoHelper = e.intersections.some((hit) => {
              let obj: Object3D | null = hit.object;
              while (obj) {
                if (obj.userData?.isGizmoHelper || obj.userData?.isGizmo) return true;
                obj = obj.parent;
              }
              return false;
            });
            if (hitGizmoHelper) return;

            // Prevent clicks from passing through if this rack is behind another
            const firstRackHit = e.intersections.find(
              (hit) => (hit.object as Mesh).geometry === SHARED_GEO.interactBox
            );
            if (firstRackHit && firstRackHit.object !== e.eventObject) {
              return;
            }

            const state = useStore.getState();
            const isAlreadySelected = state.selectedRackId === rackId;

            if (!isAlreadySelected) {
              // FIRST CLICK: Select the rack and completely stop the click from falling through!
              e.stopPropagation();
              state.selectRack(rackId);
              if (!state.isEditMode) {
                state.focusRack(rackId);
              }
            } else {
              // ALREADY SELECTED: Allow click to pass through to devices inside the rack.
              // The background sphere will still ignore it because stoppedByRack is true.
            }
          }}
          onPointerOver={isObstructing ? undefined : (e) => {
            if (useStore.getState().isGizmoHovered) return;
            const hitGizmoHelper = e.intersections.some((hit) => {
              let obj: Object3D | null = hit.object;
              while (obj) {
                if (obj.userData?.isGizmoHelper || obj.userData?.isGizmo) return true;
                obj = obj.parent;
              }
              return false;
            });
            if (hitGizmoHelper) return;

            const state = useStore.getState();
            const isSelected = state.selectedRackId === rackId;

            // Only capture hover for the rack if it is NOT selected
            if (!isSelected) {
              e.stopPropagation();
              setHoveredRack(rackId);
              if (!state.isDragging) {
                document.body.style.cursor = state.isEditMode ? "grab" : "pointer";
              }
            }
          }}
          onPointerOut={isObstructing ? undefined : () => {
            const state = useStore.getState();
            if (state.hoveredRackId === rackId) {
              setHoveredRack(null);
              if (
                document.body.style.cursor === "grab" ||
                document.body.style.cursor === "pointer"
              ) {
                document.body.style.cursor = "auto";
              }
            }
          }}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        {/* Phase 1: 호버 태그 — DOM 마운트 비용 방지 대신 수백 개의 Html 컴포넌트가 프레임을 저하시키는 것을 방지하기 위해 isHovered 상태에서만 렌더링 */}
        <Billboard position={[0, height / 2 + 0.15, 0]} visible={isHovered}>
          {isHovered && (
            <Html center zIndexRange={[0, 10]} style={{ pointerEvents: "none" }}>
              <div
                style={{
                  background: isDarkMode
                    ? "rgba(23, 24, 28, 0.85)"
                    : "rgba(255, 255, 255, 0.9)",
                  color: isDarkMode ? "#ebedef" : "#202226",
                  padding: "4px 12px",
                  borderRadius: "16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  border: isDarkMode
                    ? isSelected
                      ? "1px solid #FFFFFF"
                      : "1px solid rgba(255, 255, 255, 0.1)"
                    : isSelected
                      ? "1px solid #1a73e8"
                      : "1px solid rgba(0, 0, 0, 0.08)",
                  boxShadow: isDarkMode
                    ? "0 4px 15px rgba(0, 0, 0, 0.4)"
                    : "0 4px 12px rgba(0, 0, 0, 0.1)",
                  whiteSpace: "nowrap",
                  backdropFilter: "blur(8px)",
                  pointerEvents: "none",
                  userSelect: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontFamily: "Inter, system-ui, sans-serif",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: isDarkMode
                      ? isSelected
                        ? "#FFFFFF"
                        : "#4d5261"
                      : "#1a73e8",
                    display: "inline-block",
                  }}
                />
                <span>{`${rackSize}U`}</span>
                <span style={{ opacity: 0.4 }}>|</span>
                <span>
                  {rackTitle || `Rack ${rackId.slice(0, 4).toUpperCase()}`}
                </span>
              </div>
            </Html>
          )}
        </Billboard>

        {isInternalFocused && !isEditMode && (
          <group position={[0, 0, depth / 2 - 0.02]}>
            {/* Top Blue LED Line (Core) - Made very thin */}
            <mesh position={[0, height / 2 - 0.03, 0]}>
              <boxGeometry args={[width - 0.08, 0.005, 0.005]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            {/* Top Blue Glow Lights extracted to GlobalFocusLights */}

            {/* Bottom Blue LED Line (Core) */}
            <mesh position={[0, -height / 2 + 0.03, 0]}>
              <boxGeometry args={[width - 0.08, 0.005, 0.005]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            {/* Bottom Blue Glow Lights extracted to GlobalFocusLights */}
          </group>
        )}

        <group position={[0, 0, depth / 2 - 0.07]}>
          {/* Main White Light extracted to GlobalFocusLights */}
          {devices.map((device) => (
            <MemoDeviceMesh
              key={device.itemId}
              device={device}
              rackHeight={height}
              rackWidth={width}
              rackId={rackId}
              isObstructing={isObstructing}
              rackTitle={rackTitle}
            />
          ))}
        </group>
        {/* Only mount ErrorMarker when rack has error devices and NOT in edit mode */}
        {!isEditMode && devices.some((d) => d.portStates?.some((p) => p.status === "error")) && (
          <ErrorMarker
            rack={{
              rackId,
              rackSize,
              position,
              devices,
              width,
              mapId,
            }}
          />
        )}
      </group>
    </>
  );
});

// Phase 1: PerforatedPanel — IIFE 제거, memo 컴포넌트로 분리
const PerforatedPanel = memo(({ xOff, rotY, panelW, panelH, color, texture }: {
  xOff: number; rotY: number; panelW: number; panelH: number; color: string; texture: CanvasTexture;
}) => (
  <group position={[xOff, 0, 0]} rotation={[0, rotY, 0]}>
    <mesh>
      <planeGeometry args={[panelW, panelH]} />
      <meshStandardMaterial
        color={color}
        roughness={0.7}
        metalness={0.8}
        alphaMap={texture}
        transparent
        alphaTest={0.5}
        side={DoubleSide}
        depthWrite={false}
      />
    </mesh>
  </group>
));

// Phase 1: MemoDeviceMesh — onSelect를 내부에서 안정화
const MemoDeviceMesh = memo(({ device, rackHeight, rackWidth, rackId, isObstructing, rackTitle }: {
  device: Device; rackHeight: number; rackWidth: number; rackId: string; isObstructing: boolean; rackTitle?: string;
}) => {
  const onSelect = useCallback(() => {
    const { focusRack, selectDevice, isEditMode } = useStore.getState();
    if (isEditMode) return;
    if (selectedRackIdBeforePointerDown === rackId) {
      selectDevice(device.itemId);
    } else {
      focusRack(rackId);
    }
  }, [rackId, device.itemId]);

  return (
    <DeviceMesh
      device={device}
      rackHeight={rackHeight}
      rackWidth={rackWidth}
      onSelect={onSelect}
      isObstructing={isObstructing}
      rackTitle={rackTitle}
      rackId={rackId}
    />
  );
});

const EMPTY_ARRAY: any[] = [];

const DeviceMesh = ({
  device,
  rackHeight,
  rackWidth,
  onSelect,
  isObstructing,
  rackTitle,
  rackId,
  isRackFocused,
}: {
  device: Device;
  rackHeight: number;
  rackWidth: number;
  onSelect: () => void;
  isObstructing?: boolean;
  rackTitle?: string;
  rackId: string;
  isRackFocused?: boolean;
}) => {
  const meshRef = useRef<Mesh>(null);
  const faceplateRef = useRef<Mesh>(null);
  const highlightedDeviceId = useStore((s) => s.highlightedDeviceId);
  const isHighlighted = highlightedDeviceId === device.itemId || (device.deviceId && highlightedDeviceId === device.deviceId);
  const [isDeviceHovered, setIsDeviceHovered] = useState(false);

  const deviceH = device.size * U_HEIGHT;
  const bottomY = -rackHeight / 2;
  const yOffset = (device.position - 1) * U_HEIGHT;
  const centerY = bottomY + yOffset + deviceH / 2 + 0.05;
  const deviceWidth = rackWidth - 0.06;

  const isEditMode = useStore((s) => s.isEditMode);

  const { hasError, errorColor } = useMemo(() => {
    if (isEditMode) return { hasError: false, errorColor: null };
    const err = getHighestError(device.portStates);
    return {
      hasError: err !== null,
      errorColor: err?.color ?? null,
    };
  }, [device.portStates, isEditMode]);

  // 에러 + 선택 + 호버 모두 애니메이션(또는 발광) 필요
  const needsAnimation = isHighlighted || isDeviceHovered || (hasError && !!errorColor);

  // Cache Color objects to avoid per-frame allocation
  const highlightColor = useMemo(() => new Color("#4dabf7"), []);
  const blackColor = useMemo(() => new Color("#000000"), []);

  // Reset emissive once when animation stops (instead of every frame)
  useEffect(() => {
    if (!needsAnimation) {
      const bodyMat = meshRef.current?.material;
      const faceMat = faceplateRef.current?.material;
      if (bodyMat instanceof MeshStandardMaterial) {
        bodyMat.emissive.copy(blackColor);
        bodyMat.emissiveIntensity = 0;
        bodyMat.opacity = 1.0;
      }
      if (faceMat instanceof MeshStandardMaterial) {
        faceMat.emissive.copy(blackColor);
        faceMat.emissiveIntensity = 0;
        faceMat.opacity = 1.0;
      }
    }
  }, [needsAnimation, blackColor]);

  // Phase 1-C: early return 패턴으로 빈 함수 호출 오버헤드 제거
  useFrame((state) => {
    if (!needsAnimation) return;
    state.invalidate();
    const clock = state.clock;

    const bodyMat = meshRef.current?.material;
    const faceMat = faceplateRef.current?.material;

    if (hasError && errorColor) {
      const intensity =
        0.5 + Math.sin(clock.getElapsedTime() * Math.PI * 3) * 0.5;

      if (bodyMat instanceof MeshStandardMaterial) {
        bodyMat.emissive.set(errorColor);
        bodyMat.emissiveIntensity = intensity * 0.375;
      }
      if (faceMat instanceof MeshStandardMaterial) {
        faceMat.emissive.set(errorColor);
        faceMat.emissiveIntensity = intensity * 0.875;
      }
    } else if (isHighlighted) {
      const pulse =
        0.5 + Math.sin(clock.getElapsedTime() * Math.PI * 1.6) * 0.5;

      if (bodyMat instanceof MeshStandardMaterial) {
        bodyMat.emissive.copy(highlightColor);
        bodyMat.emissiveIntensity = pulse * 4;
      }
      if (faceMat instanceof MeshStandardMaterial) {
        faceMat.emissive.copy(highlightColor);
        faceMat.emissiveIntensity = pulse * 4;
      }
    } else if (isDeviceHovered) {
      // Hovered device uses outline only, not material glow.
      if (bodyMat instanceof MeshStandardMaterial) {
        bodyMat.emissive.copy(blackColor);
        bodyMat.emissiveIntensity = 0;
      }
      if (faceMat instanceof MeshStandardMaterial) {
        faceMat.emissive.copy(blackColor);
        faceMat.emissiveIntensity = 0;
      }
    }
  });

  const customModels = useStore((s) => s.customModels);

  const thumbUrl = useMemo(
    () => {
      // 1. Per-device override (if any)
      if (device.devicePngRaw) {
        return device.devicePngRaw;
      }
      // 2. Custom variant thumbnail
      const customModel = customModels.find(m => m.modelName === device.modelName);
      if (customModel && customModel.modelPngRaw) {
        return customModel.modelPngRaw;
      }
      // 3. Fallback to default static image (which includes chassis-thumbnails)
      return resolveDeviceImage(device.modelName, device.defaultViewSide || "front");
    },
    [device.defaultViewSide, device.modelName, device.devicePngRaw, customModels],
  );

  const resolvedUrl = useDeferredValue(thumbUrl);

  return (
    <group
      position={[0, centerY, -0.41]}
      onClick={(e) => {
        if (isObstructing) return;
        if (e.delta > 5) return; // Ignore if it was a drag

        if (useStore.getState().isGizmoHovered) return;
        const hitGizmoHelper = e.intersections.some((hit) => {
          let obj: Object3D | null = hit.object;
          while (obj) {
            if (obj.userData?.isGizmoHelper || obj.userData?.isGizmo) return true;
            obj = obj.parent;
          }
          return false;
        });
        if (hitGizmoHelper) return;

        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        if (isObstructing) return;
        const state = useStore.getState();
        if (state.isGizmoHovered) return;
        if (state.isEditMode && state.selectedRackId === rackId) return;

        const hitGizmoHelper = e.intersections.some((hit) => {
          let obj: Object3D | null = hit.object;
          while (obj) {
            if (obj.userData?.isGizmoHelper || obj.userData?.isGizmo) return true;
            obj = obj.parent;
          }
          return false;
        });
        if (hitGizmoHelper) return;

        e.stopPropagation();
        setIsDeviceHovered(true);
        state.setHoveredDevice({
          device,
          x: e.clientX,
          y: e.clientY,
          rackTitle: rackTitle || `Rack ${rackId.substring(0, 4).toUpperCase()}`,
          rackId,
        });
        document.body.style.cursor = "pointer";
      }}
      onPointerMove={(e) => {
        if (isObstructing) return;
        const state = useStore.getState();
        if (state.isGizmoHovered) return;
        if (state.isEditMode && state.selectedRackId === rackId) return;

        const hitGizmoHelper = e.intersections.some((hit) => {
          let obj: Object3D | null = hit.object;
          while (obj) {
            if (obj.userData?.isGizmoHelper || obj.userData?.isGizmo) return true;
            obj = obj.parent;
          }
          return false;
        });
        if (hitGizmoHelper) {
          const { hoveredDevice, setHoveredDevice } = state;
          if (hoveredDevice?.device.itemId === device.itemId) {
            setIsDeviceHovered(false);
            setHoveredDevice(null);
          }
          return;
        }

        e.stopPropagation();
        state.setHoveredDevice({
          device,
          x: e.clientX,
          y: e.clientY,
          rackTitle: rackTitle || `Rack ${rackId.substring(0, 4).toUpperCase()}`,
          rackId,
        });
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setIsDeviceHovered(false);
        const { hoveredDevice, setHoveredDevice } = useStore.getState();
        if (hoveredDevice?.device.itemId === device.itemId) {
          setHoveredDevice(null);
        }
        if (document.body.style.cursor === "pointer") {
          document.body.style.cursor = "auto";
        }
      }}
    >
      {(() => {
        const content = (
          <>
            <mesh ref={meshRef}>
              <boxGeometry args={[deviceWidth, deviceH - 0.005, DEVICE_DEPTH]} />
              <meshStandardMaterial
                color="#222222"
                roughness={0.4}
                metalness={0.7}
              />
              {isDeviceHovered && meshRef.current?.geometry && (
                <Edges
                  geometry={meshRef.current.geometry}
                  scale={1.01}
                  threshold={0.1}
                  color="#5ee0ff"
                  lineWidth={4}
                />
              )}
            </mesh>

            <group position={[0, 0, DEVICE_DEPTH / 2 + 0.001]}>
              {resolvedUrl ? (
                <Suspense fallback={
                  <ImageFaceplate
                    url={thumbUrl || ""}
                    width={deviceWidth}
                    height={deviceH - 0.005}
                    hasError={hasError}
                  />
                }>
                  <ImageFaceplate
                    url={resolvedUrl}
                    width={deviceWidth}
                    height={deviceH - 0.005}
                    ref={faceplateRef}
                    hasError={hasError}
                  />
                </Suspense>
              ) : (
                <DeviceFaceplate
                  type={device.type}
                  width={deviceWidth}
                  height={deviceH - 0.005}
                  ref={faceplateRef}
                  hasError={hasError}
                  errorColor={errorColor}
                />
              )}
            </group>
          </>
        );

        return content;
      })()}
    </group>
  );
};

// Phase 3: memo로 래핑하여 동일 url/size에 대한 불필요한 텍스처 리렌더 방지
const ImageFaceplate = memo(forwardRef<
  Mesh,
  {
    url: string;
    width: number;
    height: number;
    hasError?: boolean;
  }
>(({ url, width, height, hasError }, ref) => {
  const texture = useTexture(url);
  return (
    <mesh position={[0, 0, 0]} ref={ref}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial
        map={texture}
        color={hasError ? [0.8, 0.8, 0.8] : [2.5, 2.5, 2.5]}
        bumpMap={texture}
        bumpScale={10}
        toneMapped={false}
      />
    </mesh>
  );
}));

const DeviceFaceplate = forwardRef<
  Mesh,
  {
    type: Device["type"];
    width: number;
    height: number;
    hasError?: boolean;
    errorColor?: string | null;
  }
>(({ type, width, height, hasError, errorColor }, ref) => {
  const isServer = type === "Server";
  const isRouter = type === "Router";
  const isSwitch = type === "Switch";

  return (
    <group>
      <mesh ref={ref}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#1a1a1a"
          roughness={0.8}
        />
      </mesh>

      <mesh position={[-width / 2 + 0.04, 0, 0.001]}>
        <circleGeometry args={[0.006, 16]} />
        <meshBasicMaterial
          color={hasError && errorColor ? errorColor : "#00ff00"}
        />
      </mesh>
      <mesh position={[-width / 2 + 0.06, 0, 0.001]}>
        <circleGeometry args={[0.006, 16]} />
        <meshBasicMaterial
          color={
            hasError && errorColor
              ? errorColor
              : isServer
                ? "#00ff00"
                : "#ffaa00"
          }
        />
      </mesh>

      {isSwitch && (
        <group position={[0.05, 0, 0.001]}>
          {Array.from({ length: 12 }).map((_, i) => (
            <mesh
              key={i}
              position={[-0.15 + (i % 6) * 0.06, i < 6 ? 0.01 : -0.01, 0]}
            >
              <planeGeometry args={[0.04, 0.015]} />
              <meshStandardMaterial color="#000" />
            </mesh>
          ))}
        </group>
      )}
      {isRouter && (
        <group position={[0.05, 0, 0.001]}>
          <mesh position={[-0.1, 0, 0]}>
            <boxGeometry args={[0.08, height * 0.5, 0.01]} />
            <meshStandardMaterial color="#333" />
          </mesh>
          <mesh position={[0.1, 0, 0]}>
            <boxGeometry args={[0.08, height * 0.5, 0.01]} />
            <meshStandardMaterial color="#333" />
          </mesh>
        </group>
      )}
      {isServer && (
        <group position={[0.05, 0, 0.001]}>
          {Array.from({ length: 4 }).map((_, i) => (
            <mesh key={i} position={[-0.15 + i * 0.1, 0, 0]}>
              <boxGeometry args={[0.08, height * 0.8, 0.005]} />
              <meshStandardMaterial color="#333" />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
});
