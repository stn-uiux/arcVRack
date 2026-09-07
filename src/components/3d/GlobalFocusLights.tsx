import React, { useMemo } from "react";
import { useStore } from "../../store/useStore";
import { U_HEIGHT, GRID_SPACING } from "../layout/constants";

const RACK_D = 1.0;

export const GlobalFocusLights = () => {
  const focusedRackId = useStore((s) => s.focusedRackId);
  const selectedRackId = useStore((s) => s.selectedRackId);
  const racks = useStore((s) => s.racks);
  const isEditMode = useStore((s) => s.isEditMode);
  const cyberSpaceEnabled = useStore((s) => s.cyberSpaceEnabled);

  // Focus takes precedence over selection for lighting effects
  const activeRackId = focusedRackId || selectedRackId;

  const rack = useMemo(() => {
    if (!activeRackId) return null;
    return racks.find((r) => r.rackId === activeRackId) || null;
  }, [racks, activeRackId]);

  // Show blue glow if selected or focused
  const showLights = !!rack && !isEditMode;
  // Show bright white only if explicitly focused
  const isFocused = !!focusedRackId && !isEditMode;

  const { position, rotation, width, height, depth } = useMemo(() => {
    if (!rack) {
      // Return safe defaults when nothing is selected
      return {
        position: [0, -100, 0] as [number, number, number], // hide it below floor
        rotation: [0, 0, 0] as [number, number, number],
        width: 0.6,
        height: 42 * U_HEIGHT,
        depth: RACK_D,
      };
    }

    const rackX = rack.position[0] * GRID_SPACING;
    const rackZ = rack.position[1] * GRID_SPACING;
    const h = rack.rackSize * U_HEIGHT + 0.1; // adding 0.1 as per Rack.tsx
    const w = rack.width || 0.6;
    const d = (rack as any).depth || RACK_D;
    const orientation = rack.orientation ?? 180;
    const rot = [
      0,
      ((180 - orientation) * Math.PI) / 180,
      0,
    ] as [number, number, number];

    return {
      position: [rackX, h / 2, rackZ] as [number, number, number],
      rotation: rot,
      width: w,
      height: h,
      depth: d,
    };
  }, [rack]);

  return (
    <group position={position} rotation={rotation}>
      {/* Blue glow lights (top and bottom) */}
      <group position={[0, 0, depth / 2 - 0.02]}>
        {/* Top */}
        <pointLight
          position={[-width / 3, height / 2 - 0.05, 0]}
          intensity={showLights ? 0.4 : 0}
          distance={2}
          decay={2}
          color="#00bfff"
        />
        <pointLight
          position={[0, height / 2 - 0.05, 0]}
          intensity={showLights ? 0.4 : 0}
          distance={2}
          decay={2}
          color="#00bfff"
        />
        <pointLight
          position={[width / 3, height / 2 - 0.05, 0]}
          intensity={showLights ? 0.4 : 0}
          distance={2}
          decay={2}
          color="#00bfff"
        />

        {/* Bottom */}
        <pointLight
          position={[-width / 3, -height / 2 + 0.05, 0]}
          intensity={showLights ? 0.4 : 0}
          distance={2}
          decay={2}
          color="#00bfff"
        />
        <pointLight
          position={[0, -height / 2 + 0.05, 0]}
          intensity={showLights ? 0.4 : 0}
          distance={2}
          decay={2}
          color="#00bfff"
        />
        <pointLight
          position={[width / 3, -height / 2 + 0.05, 0]}
          intensity={showLights ? 0.4 : 0}
          distance={2}
          decay={2}
          color="#00bfff"
        />
      </group>

      {/* Main white light */}
      <group position={[0, 0, depth / 2 - 0.07]}>
        <pointLight
          position={[0, 0, 1.5]}
          intensity={isFocused ? 4.0 : 0}
          distance={10}
          decay={1.5}
          color="#ffffff"
        />
      </group>
    </group>
  );
};
