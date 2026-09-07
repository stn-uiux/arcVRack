import { useEffect, Suspense } from 'react';
import { useThree } from '@react-three/fiber';
import { MeshReflectorMaterial, Grid, Plane, Environment } from '@react-three/drei';
import { EffectComposer, Bloom, N8AO, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { SpotLightWithTarget } from './SpotLightWithTarget';
import { calculateDynamicRoomSize } from "../../utils/rackGeometry";
import { useStore } from "../../store/useStore";

// Shared Materials & Colors
const CEILING_LIGHT = new THREE.Color(1.0, 1.0, 1.0).multiplyScalar(1.5);
const NEON_BLUE = new THREE.Color(0.2, 0.6, 2.0).multiplyScalar(2);

function SceneEnvironment({ fogColor, fogIntensity }: { fogColor: string, fogIntensity: number }) {
  const scene = useThree(state => state.scene);
  const isEditMode = useStore(state => state.isEditMode);

  useEffect(() => {
    // CSS 배경(그라데이션)이 투과되어 보이도록 3D 솔리드 배경 제거
    scene.background = null;

    if (isEditMode) {
      scene.fog = null;
    } else {
      // Adjusted fog back to match space project's visual depth
      scene.fog = new THREE.Fog(fogColor, 20 / Math.max(0.1, fogIntensity), 150 / Math.max(0.1, fogIntensity));
    }

    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, fogColor, fogIntensity, isEditMode]);
  return null;
}

// 가상공간이 꺼져있을 때 안개를 강제로 제거하는 유틸리티 컴포넌트
function FogRemover() {
  const scene = useThree(state => state.scene);
  const csIsLightMode = useStore(state => state.csIsLightMode);

  useEffect(() => {
    const prevFog = scene.fog;
    scene.fog = null;
    return () => {
      scene.fog = prevFog;
    };
  }, [scene, csIsLightMode]); // 모드가 바뀔 때(안개가 다시 생길 때) 다시 지우도록 감지

  return null;
}

// 가상공간이 켜졌을 때, 꺼졌을 때 썼던 환경 조명(Environment map)이 남아있는 것을 강제로 청소하는 유틸리티
function EnvCleaner() {
  const scene = useThree(state => state.scene);
  useEffect(() => {
    scene.environment = null;
  }, [scene]);
  return null;
}

function Wall({
  position,
  rotation,
  brightness,
  hasCenterNeon = false,
  hasBottomNeon = false,
  hasSpotlight = false,
  length = 4, // in meters
  color = "#334155",
  isLightMode = false,
  neonIntensity = 2.0
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  brightness: number;
  hasCenterNeon?: boolean;
  hasBottomNeon?: boolean;
  hasSpotlight?: boolean;
  length?: number;
  color?: string;
  isLightMode?: boolean;
  neonIntensity?: number;
}) {
  // Target 180cm (1.8m) width per panel
  const panelCount = Math.max(1, Math.floor(length / 1.8));
  const panelWidth = length / panelCount;

  const columns = Array.from({ length: panelCount }).map((_, i) => (i * panelWidth) + (panelWidth / 2) - (length / 2));

  return (
    <group position={position} rotation={rotation}>
      {/* Full Wall Recessed Background - height 4.06m, position y=2.02 to perfectly meet floor at -0.01 and ceiling at 4.05 */}
      <Plane position={[0, 2.02, -0.05]} args={[length + 0.1, 4.06]}>
        <meshStandardMaterial
          color={isLightMode ? "#94a3b8" : "#0f172a"}
          roughness={0.9}
          metalness={0.0}
          side={THREE.FrontSide}
        />
      </Plane>

      {columns.map((x, i) => (
        <group key={i}>
          {/* Bottom Panel - height 3.34m, position y=1.67 */}
          <Plane position={[x, 1.67, 0]} args={[panelWidth - 0.01, 3.34]}>
            <meshStandardMaterial color={color} roughness={isLightMode ? 0.9 : 0.7} metalness={isLightMode ? 0.0 : 0.5} side={THREE.FrontSide} />
          </Plane>

          {/* Top Panel - height 0.625m, position y=3.6625 */}
          <Plane position={[x, 3.6625, 0]} args={[panelWidth - 0.01, 0.625]}>
            <meshStandardMaterial color={color} roughness={isLightMode ? 0.9 : 0.7} metalness={isLightMode ? 0.0 : 0.5} side={THREE.FrontSide} />
          </Plane>

          {hasBottomNeon && (
            <Plane position={[x, 0.1, 0.01]} args={[panelWidth * 0.25, 0.01]}>
              <meshStandardMaterial emissive={NEON_BLUE} emissiveIntensity={1.5 * neonIntensity * brightness} color="#93c5fd" toneMapped={false} side={THREE.FrontSide} />
            </Plane>
          )}

          {hasCenterNeon && (
            <Plane position={[x, 3.345, 0.01]} args={[panelWidth * 0.4, 0.01]}>
              <meshStandardMaterial emissive={NEON_BLUE} emissiveIntensity={neonIntensity * brightness} color="#93c5fd" toneMapped={false} side={THREE.FrontSide} />
            </Plane>
          )}

          {/* Spotlight hitting the wall from the ceiling */}
          {hasSpotlight && (
            <SpotLightWithTarget
              position={[x, 3.9, 0.26]}
              targetPosition={[x, 0, 0]}
              color="#99ccff"
              intensity={5 * brightness}
              angle={0.8}
              penumbra={1}
              distance={25}
            />
          )}
        </group>
      ))}
    </group>
  );
}

function RoomGeometry({
  brightness,
  roomWidthCm = 400,
  roomLengthCm = 600,
  ceilingLightIntensity = 1,
  neonIntensity = 2.0,
  wallColor = "#334155",
  ceilingColor = "#050a15",
  isLightMode = false
}: {
  brightness: number,
  roomWidthCm?: number,
  roomLengthCm?: number,
  ceilingLightIntensity?: number,
  neonIntensity?: number,
  wallColor?: string,
  ceilingColor?: string,
  isLightMode?: boolean
}) {
  // Convert cm to meters
  const roomWidth = roomWidthCm / 100;
  const roomLength = roomLengthCm / 100;

  const widthPanelCount = Math.max(1, Math.floor(roomWidth / 1.8));
  const widthPanelWidth = roomWidth / widthPanelCount;
  const widthPanelCenters = Array.from({ length: widthPanelCount }).map((_, i) => (i * widthPanelWidth) + (widthPanelWidth / 2) - (roomWidth / 2));

  const lengthPanelCount = Math.max(1, Math.floor(roomLength / 1.8));
  const lengthPanelWidth = roomLength / lengthPanelCount;
  const lengthPanelSeams = lengthPanelCount > 1
    ? Array.from({ length: lengthPanelCount - 1 }).map((_, i) => (i + 1) * lengthPanelWidth - (roomLength / 2))
    : [0];

  const centerLightCols = widthPanelCount > 1
    ? Array.from({ length: widthPanelCount - 1 }).map((_, i) => (i + 1) * widthPanelWidth - (roomWidth / 2))
    : [0];

  return (
    <group>
      <Wall position={[0, 0, -roomLength / 2]} rotation={[0, 0, 0]} brightness={brightness} hasBottomNeon hasSpotlight length={roomWidth} color={wallColor} isLightMode={isLightMode} neonIntensity={neonIntensity} />
      <Wall position={[0, 0, roomLength / 2]} rotation={[0, Math.PI, 0]} brightness={brightness} hasBottomNeon hasSpotlight length={roomWidth} color={wallColor} isLightMode={isLightMode} neonIntensity={neonIntensity} />
      <Wall position={[-roomWidth / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} brightness={brightness} hasCenterNeon length={roomLength} color={wallColor} isLightMode={isLightMode} neonIntensity={neonIntensity} />
      <Wall position={[roomWidth / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]} brightness={brightness} hasCenterNeon length={roomLength} color={wallColor} isLightMode={isLightMode} neonIntensity={neonIntensity} />

      {/* Ceiling Dark Recessed Background */}
      <Plane position={[0, 4.05, 0]} args={[roomWidth + 0.1, roomLength + 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={isLightMode ? "#94a3b8" : "#0f172a"} roughness={0.9} side={THREE.FrontSide} />
      </Plane>
      {/* Ceiling Plane */}
      <Plane position={[0, 4.0, 0]} args={[roomWidth - 0.02, roomLength - 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color={ceilingColor} roughness={isLightMode ? 0.9 : 0.9} metalness={isLightMode ? 0.0 : 0.1} side={THREE.FrontSide} />
      </Plane>

      {/* Center large rectangular lights */}
      {lengthPanelSeams.map((z, rowIndex) => (
        <group key={`center-ceiling-${rowIndex}`}>
          {centerLightCols.map((x, colIndex) => (
            <group key={`center-light-${rowIndex}-${colIndex}`} position={[x, 0, z]}>
              <Plane args={[0.36, 0.96]} position={[0, 3.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <meshStandardMaterial emissive={CEILING_LIGHT} emissiveIntensity={2.5 * brightness * ceilingLightIntensity} color="#ffffff" toneMapped={false} side={THREE.FrontSide} />
              </Plane>
              <Plane args={[0.50, 1.10]} position={[0, 3.97, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <meshPhysicalMaterial
                  color="#ffffff"
                  transmission={0.8}
                  opacity={1}
                  roughness={0.5}
                  ior={1.4}
                  thickness={0.02}
                  transparent
                  side={THREE.FrontSide}
                />
              </Plane>
            </group>
          ))}
        </group>
      ))}

      {/* Circular Indirect Lights at Front and Back (Visual Only) */}
      {widthPanelCenters.map((x, colIndex) => (
        <group key={`circle-light-${colIndex}`}>
          {/* Front Wall Circular Light */}
          <group position={[x, 3.98, -roomLength / 2 + 0.26]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.069, 32]} />
              <meshStandardMaterial color={isLightMode ? "#e2e8f0" : "#0f172a"} roughness={0.8} side={THREE.FrontSide} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
              <circleGeometry args={[0.06, 32]} />
              <meshStandardMaterial emissive={CEILING_LIGHT} emissiveIntensity={2.0 * brightness * ceilingLightIntensity} color="#ffffff" toneMapped={false} side={THREE.FrontSide} />
            </mesh>
          </group>

          {/* Back Wall Circular Light */}
          <group position={[x, 3.98, roomLength / 2 - 0.26]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.069, 32]} />
              <meshStandardMaterial color={isLightMode ? "#e2e8f0" : "#0f172a"} roughness={0.8} side={THREE.FrontSide} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
              <circleGeometry args={[0.06, 32]} />
              <meshStandardMaterial emissive={CEILING_LIGHT} emissiveIntensity={2.0 * brightness * ceilingLightIntensity} color="#ffffff" toneMapped={false} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

export function CyberSpaceEnvironment() {
  const {
    cyberSpaceEnabled,
    csIsVisible,
    csIsLightMode,
    csFloorMirror,
    csFloorRoughness,
    csBrightness,
    csFogIntensity,
    csCeilingLightIntensity,
    csBloomIntensity,
    csAoIntensity,
    csNeonIntensity,
    csCustomSpaceSize,
    csRoomWidthCm,
    csRoomLengthCm,
    csOffsetXCm,
    csOffsetZCm,
    csWallColor,
    csCeilingColor,
    csFloorColor,
    csFogColor,
    csLowSpecMode,
    racks,
    isEditMode,
  } = useStore();

  const activeNodeId = useStore((state) => state.activeNodeId);
  const importedModels = useStore((state) => state.importedModels);

  const { scene, invalidate } = useThree();

  useEffect(() => {
    let count = 0;
    let timer: any;
    const trigger = () => {
      invalidate();
      count++;
      if (count < 10) timer = setTimeout(trigger, 50);
    };
    trigger();
    return () => clearTimeout(timer);
  }, [csLowSpecMode, invalidate]);

  const { width: roomWidth, length: roomLength } = calculateDynamicRoomSize(
    racks,
    importedModels,
    activeNodeId,
    csRoomWidthCm,
    csRoomLengthCm,
    csCustomSpaceSize
  );

  return (
    <>
      <group visible={!isEditMode}>
        <SceneEnvironment fogColor={csFogColor} fogIntensity={csFogIntensity} />

        {/* 가상 공간이 꺼져 있을 때 Environment 조명 추가 */}
        {!cyberSpaceEnabled && (
          <Suspense fallback={null}>
            <FogRemover />
            <Environment
              preset="city"
              environmentIntensity={csIsLightMode ? 0.6 : 0.6}
              blur={0.8}
            />
            {csIsLightMode ? (
              <>
                <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={0.8} />
              </>
            ) : (
              <>
                <ambientLight intensity={0.8 * csBrightness} color="#bcdcff" />
                <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={0.8} />
              </>
            )}
          </Suspense>
        )}


        {csIsLightMode ? (
          <>
            <ambientLight intensity={1.2 * csBrightness} color="#cde4ff" />
            <directionalLight
              position={[0, 20, 0]}
              intensity={1.4 * csBrightness}
              color="#ffffff"
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.001}
              shadow-normalBias={0.04}
            >
              <orthographicCamera attach="shadow-camera" args={[-50, 50, 50, -50, 0.1, 100]} />
            </directionalLight>
            <directionalLight position={[-10, 15, -10]} intensity={0.2 * csBrightness} color="#f0f8ff" />
            {cyberSpaceEnabled && (
              <Suspense fallback={null}>
                <hemisphereLight color="#ffffff" groundColor="#ffffff" intensity={0.8} />
              </Suspense>
            )}
          </>
        ) : (
          <>
            <directionalLight
              position={[0, 20, 0]}
              intensity={1.4 * csBrightness}
              color="#ffffff"
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-bias={-0.001}
              shadow-normalBias={0.04}
            >
              <orthographicCamera attach="shadow-camera" args={[-50, 50, 50, -50, 0.1, 100]} />
            </directionalLight>
            <directionalLight position={[-10, 15, -10]} intensity={0.2 * csBrightness} color="#f0f8ff" />
            {cyberSpaceEnabled && (
              <Suspense fallback={null}>
                <ambientLight intensity={0.5 * csBrightness} color="#93c5fd" />
              </Suspense>
            )}
          </>
        )}

        {cyberSpaceEnabled && csIsVisible && (
          <group position={[csCustomSpaceSize ? csOffsetXCm / 100 : 0, 0, csCustomSpaceSize ? csOffsetZCm / 100 : 0]}>
            <EnvCleaner />
            
            {/* Floor Dark Recessed Background */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
              <planeGeometry args={[roomWidth + 0.1, roomLength + 0.1]} />
              <meshStandardMaterial color={csIsLightMode ? "#94a3b8" : "#0f172a"} roughness={0.9} metalness={0.0} />
            </mesh>

            {csLowSpecMode ? (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                <planeGeometry args={[roomWidth - 0.02, roomLength - 0.02]} />
                <meshStandardMaterial
                  color={csFloorColor}
                  roughness={csFloorRoughness}
                  metalness={csIsLightMode ? 0.0 : 0.4}
                />
              </mesh>
            ) : (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                <planeGeometry args={[roomWidth - 0.02, roomLength - 0.02]} />
                <MeshReflectorMaterial
                  blur={[400, 400]}
                  resolution={512}
                  mixBlur={csIsLightMode ? 1.0 : 3.0}
                  mixStrength={csIsLightMode ? 0.8 : 4.0}
                  roughness={csFloorRoughness}
                  depthScale={1.2}
                  minDepthThreshold={0.4}
                  maxDepthThreshold={1.4}
                  color={csFloorColor}
                  metalness={csIsLightMode ? 0.0 : 0.4}
                  mirror={csFloorMirror}
                />
              </mesh>
            )}

            <Grid
              position={[0, 0.00005, 0]}
              args={[roomWidth - 0.02, roomLength - 0.02]}
              cellSize={0.6}
              cellThickness={0.8}
              cellColor={csIsLightMode ? '#f1f5f9' : '#0a1a33'}
              sectionSize={0}
              fadeDistance={Math.max(roomWidth, roomLength)}
              fadeStrength={1}
            />

            <RoomGeometry
              brightness={csBrightness}
              roomWidthCm={roomWidth * 100}
              roomLengthCm={roomLength * 100}
              ceilingLightIntensity={csCeilingLightIntensity}
              neonIntensity={csNeonIntensity}
              wallColor={csWallColor}
              ceilingColor={csCeilingColor}
              isLightMode={csIsLightMode}
            />
          </group>
        )}
      </group>

      <EffectComposer enabled={!isEditMode}>
        <N8AO 
          aoRadius={1} 
          intensity={csLowSpecMode ? 0 : (csIsLightMode ? csAoIntensity : csAoIntensity * 2)} 
          distanceFalloff={0.2} 
          color="black" 
        />
        {cyberSpaceEnabled && (
          <Bloom luminanceThreshold={csIsLightMode ? 2.0 : 0.8} mipmapBlur levels={7} intensity={csLowSpecMode ? 0 : 0.7 * Math.max(0.5, csBrightness) * csBloomIntensity} />
        )}
        <Vignette eskil={false} offset={0.1} darkness={csIsLightMode ? 0.25 : 0.5} />
      </EffectComposer>
    </>
  );
}
