import React, { Suspense, useMemo, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  Grid,
  GizmoHelper,
  GizmoViewcube,
  useGizmoContext,
  Edges,
  PivotControls,
} from "@react-three/drei";
import { Matrix4, Vector3, Plane, BufferGeometry, Float32BufferAttribute, BackSide } from "three";
import { useStore } from "../../store/useStore";
import { Rack } from "./Rack";
import { ImportedModelMesh } from "./ImportedModelMesh";
import { CameraController } from "./CameraController";
import { CyberSpaceEnvironment } from "./CyberSpaceEnvironment";
import { calculateDynamicRoomSize } from "../../utils/rackGeometry";
import { GRID_SPACING } from "../layout/constants";
import { useTheme } from "../../contexts/ThemeContext";
import { GlobalFocusLights } from "./GlobalFocusLights";

/**
 * Optimizes performance by baking shadow maps statically when objects are not moving.
 * Instead of calculating complex lighting/shadows on every frame (which is very expensive with many lights),
 * we only update the shadow map once when models or racks change, or continuously only while dragging.
 */
const ShadowOptimizer = () => {
  const { gl } = useThree();
  const isDragging = useStore((s) => s.isDragging);
  const draggingModelId = useStore((s) => s.draggingModelId);
  const isEditMode = useStore((s) => s.isEditMode);
  const csIsLightMode = useStore((s) => s.csIsLightMode);

  // Robustly hash all properties that could affect the physical geometry or lighting of the scene
  const racksHash = useStore((s) =>
    s.racks.map(r => `${r.rackId}-${r.position.join()}-${r.orientation}-${r.rackSize}`).join()
  );
  const modelsHash = useStore((s) =>
    s.importedModels.map(m => `${m.itemId}-${m.position.join()}-${m.rotation?.join()}-${m.lightParams?.intensity}-${m.lightParams?.color}-${m.lightParams?.castShadow}`).join()
  );

  useEffect(() => {
    if (isDragging || draggingModelId) {
      // Continuously update shadows only while dragging to see real-time preview
      gl.shadowMap.autoUpdate = true;
    } else {
      // Static view: freeze the shadow map and render it exactly once
      gl.shadowMap.autoUpdate = false;
      gl.shadowMap.needsUpdate = true;
    }
  }, [gl, isDragging, draggingModelId, isEditMode, csIsLightMode, racksHash, modelsHash]);

  return null;
};

/** Error boundary that silently catches Environment HDR load failures (e.g. offline) */
class EnvironmentErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? null : this.props.children; }
}

/** Wraps <Environment> so a failed HDR fetch doesn't crash the scene */
const EnvironmentSafe = (props: { preset: string }) => {
  const [isOffline, setIsOffline] = React.useState(!navigator.onLine);

  React.useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOffline) return null;

  return (
    <EnvironmentErrorBoundary>
      <Suspense fallback={null}>
        <Environment preset={props.preset as any} />
      </Suspense>
    </EnvironmentErrorBoundary>
  );
};

interface CameraControlsRef {
  target: Vector3;
}

/** Syncs camera & controls refs into zustand store for viewport-center spawning */
const CameraRefSync = () => {
  const { camera, controls } = useThree();
  const setCameraRef = useStore((s) => s.setCameraRef);

  useEffect(() => {
    setCameraRef(camera, controls as unknown as CameraControlsRef | null);
  }, [camera, controls, setCameraRef]);

  return null;
};

import { DefaultLoadingManager } from "three";

/** Waits for Suspense to resolve and shaders to compile before hiding loader */
const SceneReadyMonitor = ({ isReadyToMonitor }: { isReadyToMonitor: boolean }) => {
  const setCanvasReady = useStore((s) => s.setCanvasReady);
  const frameCount = useRef(0);
  const activeRef = useRef(false);
  // 최초 1회 canvas ready 달성 후에는 절대 false로 돌리지 않음
  // → 샘플 데이터 로드 등 후속 텍스처 로딩 시 암전 방지
  const hasBeenReadyOnce = useRef(false);

  useEffect(() => {
    const origStart = DefaultLoadingManager.onStart;
    const origLoad = DefaultLoadingManager.onLoad;
    const origError = DefaultLoadingManager.onError;

    DefaultLoadingManager.onStart = (url, loaded, total) => {
      activeRef.current = true;
      if (origStart) origStart(url, loaded, total);
    };
    DefaultLoadingManager.onLoad = () => {
      activeRef.current = false;
      if (origLoad) origLoad();
    };
    DefaultLoadingManager.onError = (url) => {
      activeRef.current = false;
      if (origError) origError(url);
    };

    return () => {
      DefaultLoadingManager.onStart = origStart;
      DefaultLoadingManager.onLoad = origLoad;
      DefaultLoadingManager.onError = origError;
    };
  }, []);

  useFrame((state) => {
    // 이미 한 번 ready가 된 적이 있으면, 후속 로딩에서는 false로 되돌리지 않음
    if (hasBeenReadyOnce.current) return;

    // If not ready to monitor, or if ThreeJS is still actively loading textures/models, reset.
    if (!isReadyToMonitor || activeRef.current) {
      frameCount.current = 0;
      if (useStore.getState().isCanvasReady) {
        setCanvasReady(false);
      }
      return;
    }

    if (frameCount.current < 5) {
      frameCount.current++;
      state.invalidate();
      if (frameCount.current === 5 && !useStore.getState().isCanvasReady) {
        setCanvasReady(true);
        hasBeenReadyOnce.current = true;
      }
    }
  });

  return null;
};

/** 
 * Wraps GizmoViewcube to ensure clicking Top/Bottom orients the camera 
 * with the Front (+Z) facing downwards.
 */
const CustomGizmoViewcube = (props: any) => {
  const { tweenCamera } = useGizmoContext();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = (e: any) => {
    e.stopPropagation();
    const D = new Vector3();

    // FaceCube has a lengthSq of 0 for its position, EdgeCube has > 0
    if (e.object.position.lengthSq() === 0) {
      D.copy(e.face.normal);
    } else {
      D.copy(e.object.position).normalize();
    }

    // If clicking Top or Bottom, add a solid Z offset (0.1) so OrbitControls 
    // forces an azimuth angle of 0, putting +Z (Front) at the bottom.
    // Offset must be large enough to avoid GizmoHelper's early stopping threshold,
    // which otherwise causes OrbitControls to snap to the wrong hemisphere (flip) at the very end.
    if (D.y > 0.9 && Math.abs(D.x) < 0.1 && Math.abs(D.z) < 0.1) {
      D.set(0, 1, 0.1).normalize();
    } else if (D.y < -0.9 && Math.abs(D.x) < 0.1 && Math.abs(D.z) < 0.1) {
      D.set(0, -1, 0.1).normalize();
    }

    tweenCamera(D);
  };

  return <GizmoViewcube onClick={handleClick} {...props} />;
};

const DragHandler = () => {
  const isDragging = useStore((state) => state.isDragging);
  const draggingRackId = useStore((state) => state.draggingRackId);
  const updateDragPosition = useStore((state) => state.updateDragPosition);

  const { raycaster, mouse, camera } = useThree();
  const floorPlane = useMemo(() => new Plane(new Vector3(0, 1, 0), 0), []);
  const tempPoint = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (isDragging && draggingRackId) {
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(floorPlane, tempPoint)) {
        const { dragOffset } = useStore.getState();
        const offsetX = dragOffset ? dragOffset[0] : 0;
        const offsetZ = dragOffset ? dragOffset[1] : 0;

        // No grid snapping – use raw world coordinates for smooth movement
        updateDragPosition([tempPoint.x - offsetX, tempPoint.z - offsetZ]);
      }
    }
  });

  return null;
};

export const Scene = () => {
  const racks = useStore((state) => state.racks);
  const activeNodeId = useStore((state) => state.activeNodeId);
  const nodes = useStore((state) => state.nodes);
  const isDragging = useStore((state) => state.isDragging);
  const importedModels = useStore((state) => state.importedModels);
  const draggingModelId = useStore((state) => state.draggingModelId);
  const selectedRackId = useStore((state) => state.selectedRackId);
  const isEditMode = useStore((state) => state.isEditMode);
  const csCustomSpaceSize = useStore((state) => state.csCustomSpaceSize);
  const csRoomWidthCm = useStore((state) => state.csRoomWidthCm);
  const csRoomLengthCm = useStore((state) => state.csRoomLengthCm);
  const csOffsetXCm = useStore((state) => state.csOffsetXCm);
  const csOffsetZCm = useStore((state) => state.csOffsetZCm);
  const cyberSpaceEnabled = useStore((state) => state.cyberSpaceEnabled);
  const deviceRegistrationModalOpen = useStore(
    (state) => state.deviceRegistrationModalOpen,
  );
  const importExportModalRackId = useStore(
    (state) => state.importExportModalRackId,
  );
  const selectedDeviceId = useStore((state) => state.selectedDeviceId);
  const selectedModelId = useStore((state) => state.selectedModelId);
  const { theme } = useTheme();

  const [isRoomSelected, setIsRoomSelected] = React.useState(false);

  React.useEffect(() => {
    if (selectedRackId || selectedModelId) {
      setIsRoomSelected(false);
    }
  }, [selectedRackId, selectedModelId]);

  const { width: dynamicWidth, length: dynamicLength } = calculateDynamicRoomSize(
    racks,
    importedModels,
    activeNodeId,
    csRoomWidthCm,
    csRoomLengthCm,
    csCustomSpaceSize
  );

  const wallLinesGeometry = useMemo(() => {
    const points: number[] = [];
    const halfW = dynamicWidth / 2;
    const halfL = dynamicLength / 2;
    const h = 4.0;

    // CyberSpaceEnvironment uses 1.8m target panel width
    const panelCountX = Math.max(1, Math.floor(dynamicWidth / 1.8));
    const panelWidthX = dynamicWidth / panelCountX;

    const panelCountZ = Math.max(1, Math.floor(dynamicLength / 1.8));
    const panelWidthZ = dynamicLength / panelCountZ;

    // Front & Back walls (along X axis)
    for (let i = 1; i < panelCountX; i++) {
      const x = i * panelWidthX - halfW;
      points.push(x, -h / 2, halfL, x, h / 2, halfL);
      points.push(x, -h / 2, -halfL, x, h / 2, -halfL);
    }

    // Left & Right walls (along Z axis)
    for (let i = 1; i < panelCountZ; i++) {
      const z = i * panelWidthZ - halfL;
      points.push(halfW, -h / 2, z, halfW, h / 2, z);
      points.push(-halfW, -h / 2, z, -halfW, h / 2, z);
    }

    const geom = new BufferGeometry();
    if (points.length > 0) {
      geom.setAttribute('position', new Float32BufferAttribute(points, 3));
    }
    return geom;
  }, [dynamicWidth, dynamicLength]);

  const isModalOpen =
    deviceRegistrationModalOpen ||
    importExportModalRackId !== null ||
    selectedDeviceId !== null;

  const showDashboardWidgets = !selectedRackId && !isModalOpen && !isEditMode;
  const gizmoMarginX = showDashboardWidgets ? 440 : 100;

  const csOffsetMatrix = useMemo(() => {
    return new Matrix4().makeTranslation(
      csCustomSpaceSize ? csOffsetXCm / 100 : 0,
      0,
      csCustomSpaceSize ? csOffsetZCm / 100 : 0
    );
  }, [csCustomSpaceSize, csOffsetXCm, csOffsetZCm]);

  const liveOffset = useRef({ x: csOffsetXCm, z: csOffsetZCm });

  // Phase 2-C: useMemo로 감싸서 importedModels 변경 시에만 재계산
  const hasUserLight = useMemo(
    () => importedModels.some((m) => m.builtinType === "Light"),
    [importedModels],
  );

  // Strict one-node filtering: only racks placed exactly in this node
  const groupRacks = useMemo(
    () => racks.filter((r) => r.mapId === activeNodeId),
    [racks, activeNodeId],
  );

  const isReadyToMonitor = nodes.length === 0 || activeNodeId !== null;

  // Theme-based colors
  const isDarkMode = theme === "dark";
  const backgroundColor = isEditMode
    ? isDarkMode ? "#73798e" : "#eef2f6"
    : isDarkMode
      ? "radial-gradient(circle at 50% 50%, #1e3a8a 0%, #0a1324 60%, #050b14 100%)"
      : "radial-gradient(circle at 50% 50%, #e0e7ff 0%, #cbd5e1 60%, #94a3b8 100%)";
  const gridCellColor = isDarkMode ? "#8a91a3" : "#ccc"; // 밝은 회색으로 변경하여 가시성 확보
  const gridSectionColor = isDarkMode ? "#b3b8c6" : "#999"; // 더 밝은 회색으로 섹션 구분 확실하게
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  // Global release handler using native window listener for 100% reliability
  useEffect(() => {
    const handleGlobalUp = () => {
      const state = useStore.getState();

      // Handle rack drag end
      if (state.isDragging) {
        const dragPos = state.dragPosition;
        const rackId = state.draggingRackId;

        if (rackId && dragPos) {
          // Convert raw world position to grid units (no rounding – free movement)
          const gridX = dragPos[0] / GRID_SPACING;
          const gridZ = dragPos[1] / GRID_SPACING;
          state.endDrag(rackId, [gridX, gridZ]);
        } else {
          state.setDragging(false, null);
          state.updateDragPosition(null);
        }
        document.body.style.cursor = "auto";
      }

      // Handle model drag end
      if (state.draggingModelId && state.modelDragPosition) {
        state.endModelDrag(state.draggingModelId, state.modelDragPosition);
        document.body.style.cursor = "auto";
      }
    };

    window.addEventListener("pointerup", handleGlobalUp);
    return () => window.removeEventListener("pointerup", handleGlobalUp);
  }, []);

  return (
    <Canvas
      frameloop="demand"
      shadows
      camera={{ position: [10, 10, 10], fov: 50 }}
      style={{ width: "100%", height: "100vh", background: backgroundColor }}
      onPointerLeave={() => {
        useStore.getState().setHoveredDevice(null);
      }}
    >
      {/* Only use default basic lights in Edit Mode */}
      {isEditMode && (
        <>
          <ambientLight intensity={isDarkMode ? 1.0 : 1.0} />
          {/* Only render default directional light if no user-placed Light model exists */}
          {!hasUserLight && (
            <directionalLight
              position={[10, 20, 5]}
              intensity={isDarkMode ? 1.8 : 1.8}
              castShadow
              shadow-mapSize={[1024, 1024]}
            />
          )}
          <hemisphereLight
            intensity={isDarkMode ? 0.8 : 0.8}
            color="#ffffff"
            groundColor="#ffffff"
          />
        </>
      )}

      <ShadowOptimizer />

      {/* Global Focus Lights to avoid Shader recompilation freezes on selection */}
      <GlobalFocusLights />

      {/* Robust Background Click Catcher */}
      <mesh
        scale={10000}
        onClick={(e) => {
          if (useStore.getState().isGizmoHovered) return;
          if (e.button !== 0) return;
          if (e.delta > 15) return; // ignore drags

          // Only trigger if this background click wasn't already processed by a Rack or Model
          if ((e as any).stoppedByRack || (e as any).stoppedByModel) {
            return;
          }

          useStore.getState().selectRack(null);
          useStore.getState().selectModel(null);
          setIsRoomSelected(false);
        }}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial side={BackSide} transparent opacity={0} depthWrite={false} />
      </mesh>

      {!selectedRackId && (
        <GizmoHelper alignment="top-right" margin={[gizmoMarginX, 140]} renderPriority={isEditMode ? undefined : 2}>
          <group
            scale={1.4}
            onPointerOver={() => useStore.setState({ isGizmoHovered: true })}
            onPointerOut={() => useStore.setState({ isGizmoHovered: false })}
            userData={{ isGizmoHelper: true }}
          >
            <CustomGizmoViewcube
              opacity={1}
              color={isDarkMode ? "#2A3342" : "#D8DEE8"}
              textColor={isDarkMode ? "#ffffff" : "#111827"}
              strokeColor={isDarkMode ? "#9AA4B2" : "#5B6678"}
              hoverColor={isDarkMode ? "#3b82f6" : "#2563eb"}
            />
          </group>
        </GizmoHelper>
      )}

      <Suspense fallback={null}>
        {isEditMode && <EnvironmentSafe preset="city" />}
      </Suspense>

      <Suspense fallback={null}>

        {/* Visual Grid & Room Bounds – offset slightly below y=0 to prevent z-fighting with model floors */}
        {isEditMode && (
          <group>
            {/* Server Room Bounds Wireframe */}
            {cyberSpaceEnabled && (
              <group userData={{ isGizmo: true }}>
                <PivotControls
                  visible={csCustomSpaceSize && isRoomSelected}
                  activeAxes={csCustomSpaceSize && isRoomSelected ? [true, false, true] : [false, false, false]}
                  scale={100}
                  anchor={[0, -1, 0]}
                  depthTest={false}
                  fixed
                  matrix={csOffsetMatrix}
                  disableRotations={true}
                  disableScaling={true}
                  onDragStart={() => {
                    const controls = useStore.getState()._controlsRef as any;
                    if (controls) controls.enabled = false;
                  }}
                  onDrag={(local) => {
                    const position = new Vector3();
                    position.setFromMatrixPosition(local);
                    // Update ref instead of store to avoid double-transform feedback loop
                    liveOffset.current = {
                      x: Math.round(position.x * 100),
                      z: Math.round(position.z * 100)
                    };
                  }}
                  onDragEnd={() => {
                    const controls = useStore.getState()._controlsRef as any;
                    if (controls) controls.enabled = true;
                    // Commit to store once on drag end
                    useStore.getState().setCyberSpaceConfig({
                      csOffsetXCm: liveOffset.current.x,
                      csOffsetZCm: liveOffset.current.z
                    });
                  }}
                >
                  <group position={[0, 2.0, 0]} userData={{ isInnerContent: true }}>
                    <mesh raycast={() => null}>
                      <boxGeometry args={[dynamicWidth, 4.0, dynamicLength]} />
                      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                      <Edges
                        scale={1.0}
                        color={isDarkMode ? (isRoomSelected ? "#10b981" : "#38bdf8") : (isRoomSelected ? "#059669" : "#0ea5e9")}
                        raycast={() => null}
                      />
                      {wallLinesGeometry.attributes.position && (
                        <lineSegments geometry={wallLinesGeometry} raycast={() => null}>
                          <lineBasicMaterial
                            color={isDarkMode ? (isRoomSelected ? "#10b981" : "#38bdf8") : (isRoomSelected ? "#059669" : "#0ea5e9")}
                            transparent
                            opacity={isRoomSelected ? 0.5 : 0.25}
                          />
                        </lineSegments>
                      )}
                    </mesh>
                    {/* Invisible floor mesh for easier click selection */}
                    {csCustomSpaceSize && (
                      <mesh
                        rotation={[-Math.PI / 2, 0, 0]}
                        position={[0, -2.005, 0]}
                        onClick={(e) => {
                          if (e.button !== 0) return; // Only left-click
                          if (e.delta > 15) return; // Ignore drags

                          // Only select the floor if it was the front-most object clicked
                          // (prevents selecting floor when clicking a Rack that doesn't stop propagation)
                          if (e.intersections.length > 0 && e.intersections[0].object !== e.object) {
                            return;
                          }

                          e.stopPropagation();
                          useStore.getState().selectRack(null);
                          useStore.getState().selectModel(null);
                          setIsRoomSelected(true);
                        }}
                        onPointerOver={(e) => {
                          e.stopPropagation();
                          document.body.style.cursor = "pointer";
                        }}
                        onPointerOut={() => {
                          document.body.style.cursor = "auto";
                        }}
                      >
                        <planeGeometry args={[dynamicWidth, dynamicLength]} />
                        <meshBasicMaterial
                          color={isDarkMode ? (isRoomSelected ? "#10b981" : "#38bdf8") : (isRoomSelected ? "#059669" : "#0ea5e9")}
                          transparent
                          opacity={0.3}
                          depthWrite={false}
                        />
                      </mesh>
                    )}
                  </group>
                </PivotControls>
              </group>
            )}
            <Grid
              position={[0, -0.02, 0]}
              args={[40, 40]}
              cellSize={1}
              cellThickness={0.7}
              cellColor={gridCellColor}
              sectionSize={5}
              sectionThickness={0.8}
              sectionColor={gridSectionColor}
              fadeDistance={50}
              infiniteGrid
              followCamera={false}
            />
            {/* Center Origin Marker */}
            <group position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <mesh renderOrder={1}>
                <ringGeometry args={[0.3, 0.35, 32]} />
                <meshBasicMaterial color={isDarkMode ? "#3b82f6" : "#2563eb"} transparent opacity={0.8} depthTest={false} />
              </mesh>
              <mesh renderOrder={1}>
                <planeGeometry args={[1.0, 0.03]} />
                <meshBasicMaterial color={isDarkMode ? "#3b82f6" : "#2563eb"} transparent opacity={0.8} depthTest={false} />
              </mesh>
              <mesh renderOrder={1}>
                <planeGeometry args={[0.03, 1.0]} />
                <meshBasicMaterial color={isDarkMode ? "#3b82f6" : "#2563eb"} transparent opacity={0.8} depthTest={false} />
              </mesh>
            </group>
          </group>
        )}

        {/* Universal High-Quality Environment (Lights, Floor, Post-Processing) */}
        <CyberSpaceEnvironment />

        {/* Imported 3D Models */}
        {importedModels.map((model) => (
          <ImportedModelMesh key={model.id} model={model} />
        ))}

        {/* Racks (filtered by active group) */}
        {groupRacks.map((rack) => (
          <Rack key={rack.rackId} {...rack} />
        ))}

        {/* The Hidden Drag Engine */}
        <DragHandler />

        <SceneReadyMonitor isReadyToMonitor={isReadyToMonitor} />
      </Suspense>

      <OrbitControls
        makeDefault
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2.1}
        enabled={!isDragging && !draggingModelId}
        rotateSpeed={1.2}
        panSpeed={1.2}
        zoomSpeed={1.2}
        dampingFactor={0.15}
      />
      <CameraRefSync />
      <CameraController />
    </Canvas>
  );
};
