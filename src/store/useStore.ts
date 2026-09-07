import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { idbStorage } from "../utils/indexedDBStorage";
import type {
  Rack,
  Device,
  ImportedModel,
  HierarchyNode,
  RegisteredDevice,
  PortState,
} from "../types";
import { type GeneratedPort, type CustomEquipmentModel, type CustomCardDefinition } from "../types/equipment";
import { GRID_SPACING, RACK_WIDTH_STANDARD } from "../components/layout/constants";
import {
  getFrontDirection,
  getEffectiveDimensions,
} from "../utils/rackGeometry";
import { migrateGroupNameToNodeId, NONE_NODE_ID, ROOT_NODE_ID } from "../utils/nodeUtils";
import { Camera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { layoutsEqual } from "../utils/comparison";
import initialCustomModelsData from "../utils/customModels.json";

const saveCustomModelsToProject = (models: CustomEquipmentModel[]) => {
  if (import.meta.env.DEV) {
    fetch('/__save_custom_models', {
      method: 'POST',
      body: JSON.stringify(models),
    }).catch(err => console.error('Failed to save custom models to project:', err));
  }
};

if (import.meta.hot) {
  import.meta.hot.accept("../utils/customModels.json", () => {
    // Silently accept updates to customModels.json to prevent full page reloads.
    // The Zustand store already has the latest state in memory when it initiated the save.
  });
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export interface CyberSpaceConfig {
  cyberSpaceEnabled: boolean;
  csIsLightMode: boolean;
  csFloorMirror: number;
  csFloorRoughness: number;
  csBrightness: number;
  csFogIntensity: number;
  csCeilingLightIntensity: number;
  csBloomIntensity: number;
  csAoIntensity: number;
  csNeonIntensity: number;
  csCustomSpaceSize: boolean;
  csRoomWidthCm: number;
  csRoomLengthCm: number;
  csOffsetXCm: number;
  csOffsetZCm: number;
  csWallColor: string;
  csCeilingColor: string;
  csFloorColor: string;
  csFogColor: string;
  csLowSpecMode: boolean;
}

export const DEFAULT_CYBER_SPACE_CONFIG: CyberSpaceConfig = {
  cyberSpaceEnabled: true,
  csIsLightMode: false,
  csFloorMirror: 0.5,
  csFloorRoughness: 0.7,
  csBrightness: 1.5,
  csFogIntensity: 1,
  csCeilingLightIntensity: 0.6,
  csBloomIntensity: 0.3,
  csAoIntensity: 1.5,
  csNeonIntensity: 4.5,
  csCustomSpaceSize: false,
  csRoomWidthCm: 600,
  csRoomLengthCm: 800,
  csOffsetXCm: 0,
  csOffsetZCm: 0,
  csWallColor: "#5979a3",
  csCeilingColor: '#5676a0',
  csFloorColor: '#294463',
  csFogColor: '#0a1324',
  csLowSpecMode: false,
};

export const LIGHT_THEME_CYBER_SPACE_CONFIG: CyberSpaceConfig = {
  ...DEFAULT_CYBER_SPACE_CONFIG,
  cyberSpaceEnabled: true,
  csIsLightMode: true,
  csWallColor: '#eef2ff',
  csCeilingColor: '#eef2ff',
  csFloorColor: '#9ca3af',
  csFogColor: '#f1f5f9',
  csBrightness: 1.1,
  csCeilingLightIntensity: 1.0,
  csBloomIntensity: 0.6,
  csAoIntensity: 3.0,
  csNeonIntensity: 6.0,
  csFloorMirror: 0.0,
  csFloorRoughness: 1.0,
  csLowSpecMode: false,
};

interface CameraControlsRef {
  target: Vector3;
}

export interface AppState {
  racks: Rack[];
  registeredDevices: RegisteredDevice[];
  selectedRackId: string | null;
  selectedDeviceId: string | null;
  highlightedPortId: string | null;
  focusedRackId: string | null;
  obstructingRackIds: string[];
  isDragging: boolean;
  draggingRackId: string | null;
  dragPosition: [number, number] | null;
  dragOffset: [number, number] | null;
  isEditMode: boolean;
  hoveredRackId: string | null;
  importExportModalRackId: string | null;
  deviceRegistrationModalOpen: boolean;
  modelRegistrationModalOpen: boolean;
  isSyncingPorts: boolean;
  setIsSyncingPorts: (val: boolean) => void;
  deviceDeleteConfirm: { id: string; title: string; rackName?: string } | null;
  setDeviceDeleteConfirm: (
    confirm: { id: string; title: string; rackName?: string } | null,
  ) => void;
  highlightedDeviceId: string | null;
  blinkTimeoutId: number | null; // Track current blink timer to clear it if needed
  showEquipmentInTree: boolean;
  preFocusCameraState: CameraState | null;

  // Hierarchy
  nodes: HierarchyNode[];
  activeNodeId: string | null;
  activeSceneNodeId: string | null;
  collapsedNodeIds: Set<string>;
  isHierarchyCollapsed: boolean;
  // Pinned hierarchy node (opens as main when set)
  pinnedNodeId: string | null;

  // Node-Specific 3D Layouts
  layouts: Record<string, { racks: Rack[]; importedModels: ImportedModel[] }>;

  // Camera reference for viewport-center spawning
  _cameraRef: Camera | null;
  _controlsRef: CameraControlsRef | null;

  // Gizmo interaction state
  isGizmoHovered: boolean;

  // Cyber Space Environment
  cyberSpaceEnabled: boolean;
  csIsLightMode: boolean;
  csFloorMirror: number;
  csFloorRoughness: number;
  csBrightness: number;
  csFogIntensity: number;
  csCeilingLightIntensity: number;
  csBloomIntensity: number;
  csAoIntensity: number;
  csNeonIntensity: number;
  csCustomSpaceSize: boolean;
  csRoomWidthCm: number;
  csRoomLengthCm: number;
  csOffsetXCm: number;
  csOffsetZCm: number;
  csWallColor: string;
  csCeilingColor: string;
  csFloorColor: string;
  csFogColor: string;
  csLowSpecMode: boolean;

  nodeEnvironments: Record<string, Partial<CyberSpaceConfig>>;

  isCanvasReady: boolean;
  setIsEditMode: (isEditMode: boolean) => void;
  setCanvasReady: (ready: boolean) => void;
  setCyberSpaceEnabled: (enabled: boolean) => void;
  toggleCyberSpace: () => void;
  setCyberSpaceConfig: (config: Partial<CyberSpaceConfig>) => void;
  toggleCyberSpaceTheme: () => void;
  setCyberSpaceTheme: (isLight: boolean) => void;
  csIsVisible: boolean;
  setCsIsVisible: (visible: boolean) => void;
  toggleCsIsVisible: () => void;

  // Custom Equipment Models & Cards
  customModels: CustomEquipmentModel[];
  deletedDefaultTemplates: string[];
  customCards: CustomCardDefinition[];

  // Imported 3D Models
  importedModels: ImportedModel[];
  selectedModelId: string | null;
  draggingModelId: string | null;
  modelDragPosition: [number, number] | null;
  modelDragOffset: [number, number] | null;

  // Toast Notification
  toast: { message: string; type: "success" | "error" } | null;
  setToast: (toast: { message: string; type: "success" | "error" } | null) => void;
  showToast: (
    message: string,
    type: "success" | "error",
    source?: string,
  ) => void;

  myPageModalOpen: boolean;
  setMyPageModalOpen: (open: boolean) => void;
  settingsModalOpen: boolean;
  setSettingsModalOpen: (open: boolean) => void;
  settingsModalTab: 'accounts' | 'permissions';
  setSettingsModalTab: (tab: 'accounts' | 'permissions') => void;

  // Unsaved Changes & Undo
  baselineRacks: Rack[] | null;
  baselineModels: ImportedModel[] | null;
  baselineNodes: HierarchyNode[] | null;
  baselineRegisteredDevices: RegisteredDevice[] | null;
  baselineNodeEnvironments: Record<string, Partial<CyberSpaceConfig>> | null;
  baselineLayouts: Record<string, { racks: Rack[]; importedModels: ImportedModel[] }> | null;
  baselineActiveNodeId: string | null;
  baselineActiveSceneNodeId: string | null;
  undoStack: {
    racks: Rack[];
    importedModels: ImportedModel[];
    nodes: HierarchyNode[];
    registeredDevices: RegisteredDevice[];
  }[];
  redoStack: {
    racks: Rack[];
    importedModels: ImportedModel[];
    nodes: HierarchyNode[];
    registeredDevices: RegisteredDevice[];
  }[];
  showUnsavedDialog: boolean;
  pendingAction:
  | { type: "node"; value: string | null }
  | { type: "editMode"; value: boolean }
  | null;
  _importDirty: boolean; // Forced dirty flag after import

  // Camera Trigger
  triggerFitToScene: number;
  fitToScene: () => void;

  // Actions
  reparentNode: (nodeId: string, newParentId: string | null) => void;
  setCameraRef: (camera: Camera, controls: CameraControlsRef | null) => void;
  setHoveredRack: (id: string | null) => void;
  setActiveNode: (nodeId: string | null) => void;
  setImportExportModalRackId: (id: string | null) => void;

  // Hovered Device Tooltip
  hoveredDevice: { device: Device; x: number; y: number; rackTitle?: string; rackId?: string } | null;
  setHoveredDevice: (payload: { device: Device; x: number; y: number; rackTitle?: string; rackId?: string } | null) => void;

  addRack: (
    rackSize: 24 | 32 | 48,
    position?: [number, number],
    width?: number,
  ) => void;
  moveRack: (id: string, newPosition: [number, number]) => boolean;
  deleteRack: (id: string) => void;
  selectRack: (id: string | null) => void;
  selectDevice: (id: string | null, portId?: string | null) => void;
  focusRack: (id: string | null) => void;
  setObstructingRackIds: (ids: string[]) => void;
  setPreFocusCameraState: (state: CameraState | null) => void;
  setDragging: (
    isDragging: boolean,
    rackId?: string | null,
    offset?: [number, number] | null,
  ) => void;
  updateDragPosition: (pos: [number, number] | null) => void;
  endDrag: (id: string, newPosition: [number, number]) => boolean;
  updateRackOrientation: (id: string, orientation: 0 | 90 | 180 | 270) => void;

  addDevice: (rackId: string, device: Omit<Device, "itemId">) => boolean;
  removeDevice: (rackId: string, deviceId: string) => void;
  /** Returns { rackId, nodeId, deviceId } if the registeredDeviceId is already mounted somewhere, else null */
  findExistingMount: (
    registeredDeviceId: string,
  ) => {
    rackId: string;
    nodeId: string;
    deviceId: string;
    rackName?: string;
  } | null;
  updateRack: (
    id: string,
    updates: Partial<Omit<Rack, "rackId" | "position">>,
  ) => void;

  // Registered Device Management
  setDeviceRegistrationModalOpen: (open: boolean) => void;
  setModelRegistrationModalOpen: (open: boolean) => void;

  // Custom Model/Card Management
  addCustomModel: (model: Omit<CustomEquipmentModel, 'modelId'>) => string;
  updateCustomModel: (modelId: string, updates: Partial<CustomEquipmentModel>) => void;
  removeCustomModel: (modelId: string) => void;
  addCustomCard: (card: Omit<CustomCardDefinition, 'cardId'>) => string;
  removeCustomCard: (cardId: string) => void;
  removeDefaultTemplate: (modelName: string) => void;
  restoreDefaultTemplate: (modelName: string) => void;
  setHighlightedDevice: (id: string | null, duration?: number) => void;
  setShowEquipmentInTree: (show: boolean) => void;
  addRegisteredDevice: (device: Omit<RegisteredDevice, "deviceId">) => void;
  removeRegisteredDevice: (id: string) => void;
  updateRegisteredDevice: (
    id: string,
    updates: Partial<RegisteredDevice> & { generatedPorts?: GeneratedPort[] },
    skipUndo?: boolean,
  ) => void;
  upsertRegisteredDevices: (devices: Omit<RegisteredDevice, "deviceId">[]) => {
    added: number;
    updated: number;
  };

  // Import/Export flow enhancements
  pendingImportFile: File | null;
  setPendingImportFile: (file: File | null) => void;

  // Imported Model Actions
  addImportedModel: (model: Omit<ImportedModel, "id">) => string | null;
  selectModel: (id: string | null) => void;
  deleteModel: (id: string) => void;
  updateModel: (
    id: string,
    updates: Partial<Omit<ImportedModel, "id">>,
  ) => void;
  setModelDragging: (
    modelId: string | null,
    pos?: [number, number] | null,
    offset?: [number, number] | null,
  ) => void;
  updateModelDragPosition: (pos: [number, number] | null) => void;
  endModelDrag: (id: string, position: [number, number]) => void;
  toggleModelMove: (id: string) => void;

  // Hierarchy Node Management
  addNode: (node: Omit<HierarchyNode, "nodeId"> & { nodeId?: string }) => string;
  renameNode: (nodeId: string, name: string) => void;
  deleteNode: (nodeId: string) => void;
  locateDevice: (registeredDeviceId: string) => boolean;
  upsertNodes: (
    nodes: HierarchyNode[],
    overwrite: boolean,
    dryRun?: boolean,
  ) => { mapping: Record<string, string>; updatedNodes: HierarchyNode[] };
  setCollapsedNodeIds: (ids: Set<string>) => void;
  toggleNodeExpansion: (nodeId: string, expand?: boolean) => void;
  expandNodePath: (nodeId: string | null) => void;
  setHierarchyCollapsed: (collapsed: boolean) => void;
  setPinnedNode: (nodeId: string | null) => void;
  reorderNode: (
    nodeId: string,
    targetNodeId: string,
    position: "before" | "after" | "inside",
  ) => void;

  // Data Persistence
  loadState: (
    racks: Rack[],
    models?: ImportedModel[],
    registeredDevices?: RegisteredDevice[],
    nodes?: HierarchyNode[],
  ) => void;
  replaceNodeData: (
    nodeId: string | "ALL",
    newRacks: Rack[],
    newRegisteredDevices?: RegisteredDevice[],
  ) => void;
  replaceMultipleNodesData: (
    data: Record<
      string,
      { racks: Rack[]; registeredDevices: RegisteredDevice[] }
    >,
  ) => void;
  updateDevicePortStates: (
    deviceId: string,
    newPortStates: import("../types").PortState[]
  ) => void;

  // Edit Session Actions
  pushUndoState: () => void;
  undo: () => void;
  redo: () => void;
  saveChanges: () => void;
  discardChanges: () => void;
  cancelConfirmation: () => void;
  getIsDirty: () => boolean;
  getDirtyNodeIds: () => Set<string>;
  resetAllData: () => void;
}

// Helper to check collision using AABB (Axis-Aligned Bounding Box)
const checkCollision = (
  racks: Rack[],
  idToExclude: string | null,
  pos: [number, number],
  width: number,
  orientation: 0 | 90 | 180 | 270 = 180,
): boolean => {
  const { effectiveWidth: w1, effectiveDepth: d1 } = getEffectiveDimensions(
    width,
    orientation,
  );
  const x1 = pos[0] * GRID_SPACING;
  const z1 = pos[1] * GRID_SPACING;

  return racks.some((r) => {
    if (r.rackId === idToExclude) return false;

    const { effectiveWidth: w2, effectiveDepth: d2 } = getEffectiveDimensions(
      r.width,
      r.orientation ?? 180,
    );
    const x2 = r.position[0] * GRID_SPACING;
    const z2 = r.position[1] * GRID_SPACING;

    // AABB overlap check
    const overlapX = Math.abs(x1 - x2) < (w1 + w2) / 2 - 0.01; // Small buffer
    const overlapZ = Math.abs(z1 - z2) < (d1 + d2) / 2 - 0.01;

    return overlapX && overlapZ;
  });
};

// Helper to check front clearance violation (combined Rule A + Rule B)
export const checkFrontClearanceViolation = (
  racks: Rack[],
  movedRackId: string,
  newPos: [number, number],
  movedRackOrientation?: 0 | 90 | 180 | 270,
  movedRackWidth?: number,
): boolean => {
  const CLEARANCE = 1.74;

  const movedRack = racks.find((r) => r.rackId === movedRackId);
  const placedOrientation =
    movedRackOrientation ?? movedRack?.orientation ?? 180;
  const placedWidth = movedRackWidth ?? movedRack?.width ?? RACK_WIDTH_STANDARD;

  const placedFrontDir = getFrontDirection(placedOrientation);
  const placedDims = getEffectiveDimensions(placedWidth, placedOrientation);

  const isInFront = (
    frontDir: { x: number; z: number },
    sourceDims: { effectiveWidth: number; effectiveDepth: number },
    otherDims: { effectiveWidth: number; effectiveDepth: number },
    deltaX: number,
    deltaZ: number,
  ): boolean => {
    if (frontDir.x !== 0) {
      const inFront = frontDir.x > 0 ? deltaX > 0 : deltaX < 0;
      const withinClearance = Math.abs(deltaX) <= CLEARANCE;
      const aligned =
        Math.abs(deltaZ) <
        (sourceDims.effectiveDepth + otherDims.effectiveDepth) / 2 - 0.05;
      if (inFront && withinClearance && aligned) return true;
    }
    if (frontDir.z !== 0) {
      const inFront = frontDir.z > 0 ? deltaZ > 0 : deltaZ < 0;
      const withinClearance = Math.abs(deltaZ) <= CLEARANCE;
      const aligned =
        Math.abs(deltaX) <
        (sourceDims.effectiveWidth + otherDims.effectiveWidth) / 2 - 0.05;
      if (inFront && withinClearance && aligned) return true;
    }
    return false;
  };

  for (const otherRack of racks) {
    if (otherRack.rackId === movedRackId) continue;

    const otherOrientation = otherRack.orientation ?? 180;
    const otherDims = getEffectiveDimensions(otherRack.width, otherOrientation);
    const deltaToOtherX = (otherRack.position[0] - newPos[0]) * GRID_SPACING;
    const deltaToOtherZ = (otherRack.position[1] - newPos[1]) * GRID_SPACING;

    if (
      isInFront(
        placedFrontDir,
        placedDims,
        otherDims,
        deltaToOtherX,
        deltaToOtherZ,
      )
    ) {
      return true;
    }

    const otherFrontDir = getFrontDirection(otherOrientation);
    const deltaFromOtherX = (newPos[0] - otherRack.position[0]) * GRID_SPACING;
    const deltaFromOtherZ = (newPos[1] - otherRack.position[1]) * GRID_SPACING;

    if (
      isInFront(
        otherFrontDir,
        otherDims,
        placedDims,
        deltaFromOtherX,
        deltaFromOtherZ,
      )
    ) {
      return true;
    }
  }

  return false;
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      racks: [],
      registeredDevices: [],
      selectedRackId: null,
      selectedDeviceId: null,
      highlightedPortId: null,
      focusedRackId: null,
      obstructingRackIds: [],
      isDragging: false,
      draggingRackId: null,
      dragPosition: null,
      dragOffset: null,
      isEditMode: false,
      isCanvasReady: false,
      hoveredRackId: null,
      nodes: [{ nodeId: ROOT_NODE_ID, parentId: null, name: "STN", type: "root", order: 0 }],
      activeNodeId: null,
      activeSceneNodeId: null,
      pinnedNodeId: null,
      collapsedNodeIds: new Set(),
      isHierarchyCollapsed: false,
      layouts: {},
      importExportModalRackId: null,
      deviceRegistrationModalOpen: false,
      modelRegistrationModalOpen: false,
      isSyncingPorts: false,
      setIsSyncingPorts: (val) => set({ isSyncingPorts: val }),
      deviceDeleteConfirm: null,
      setDeviceDeleteConfirm: (confirm) => set({ deviceDeleteConfirm: confirm }),
      highlightedDeviceId: null,
      blinkTimeoutId: null,
      showEquipmentInTree: false,
      preFocusCameraState: null,
      pendingImportFile: null,
      setPendingImportFile: (file) => set({ pendingImportFile: file }),

      isGizmoHovered: false,

      ...DEFAULT_CYBER_SPACE_CONFIG,

      nodeEnvironments: {},

      setCanvasReady: (ready: boolean) => set({ isCanvasReady: ready }),
      setCyberSpaceEnabled: (enabled) => get().setCyberSpaceConfig({ cyberSpaceEnabled: enabled }),
      toggleCyberSpace: () => get().setCyberSpaceConfig({ cyberSpaceEnabled: !get().cyberSpaceEnabled }),
      setCyberSpaceConfig: (config) => set((state) => {
        const activeNodeId = state.activeNodeId;
        const newNodeEnvs = activeNodeId ? {
          ...state.nodeEnvironments,
          [activeNodeId]: {
            ...(state.nodeEnvironments[activeNodeId] || {}),
            ...config
          }
        } : state.nodeEnvironments;

        return { ...state, ...config, nodeEnvironments: newNodeEnvs };
      }),
      setCyberSpaceTheme: (isLight) => set((state) => {
        const themeConfig = isLight ? LIGHT_THEME_CYBER_SPACE_CONFIG : DEFAULT_CYBER_SPACE_CONFIG;

        // Preserve custom size values and low spec mode when swapping theme
        const preservedState = {
          cyberSpaceEnabled: state.cyberSpaceEnabled,
          csLowSpecMode: state.csLowSpecMode,
          csCustomSpaceSize: state.csCustomSpaceSize,
          csRoomWidthCm: state.csRoomWidthCm,
          csRoomLengthCm: state.csRoomLengthCm,
          csOffsetXCm: state.csOffsetXCm,
          csOffsetZCm: state.csOffsetZCm
        };

        const newConfig = { ...themeConfig, ...preservedState };

        return { ...state, ...newConfig };
      }),
      toggleCyberSpaceTheme: () => {
        const state = get();
        state.setCyberSpaceTheme(!state.csIsLightMode);
      },

      csIsVisible: true,
      setCsIsVisible: (visible) => set({ csIsVisible: visible }),
      toggleCsIsVisible: () => set((state) => ({ csIsVisible: !state.csIsVisible })),

      _cameraRef: null,
      _controlsRef: null,

      customModels: (initialCustomModelsData as any) || [],
      deletedDefaultTemplates: [],
      customCards: [],

      importedModels: [],
      selectedModelId: null,
      draggingModelId: null,
      modelDragPosition: null,
      modelDragOffset: null,

      toast: null,
      setToast: (toast) => set({ toast }),
      showToast: (message, type) => {
        set({ toast: { message, type } });
        setTimeout(() => {
          set((state) => (state.toast?.message === message ? { toast: null } : state));
        }, 3000);
      },

      myPageModalOpen: false,
      setMyPageModalOpen: (open) => set({ myPageModalOpen: open }),
      settingsModalOpen: false,
      setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
      settingsModalTab: 'accounts',
      setSettingsModalTab: (tab) => set({ settingsModalTab: tab }),

      baselineRacks: null,
      baselineModels: null,
      baselineNodes: null,
      baselineRegisteredDevices: null,
      baselineNodeEnvironments: null,
      baselineLayouts: null,
      baselineActiveNodeId: null,
      baselineActiveSceneNodeId: null,
      undoStack: [],
      redoStack: [],
      showUnsavedDialog: false,
      pendingAction: null,
      _importDirty: false,

      triggerFitToScene: 0,
      fitToScene: () =>
        set((state) => ({
          triggerFitToScene: state.triggerFitToScene + 1,
          focusedRackId: null,
          obstructingRackIds: [],
          selectedRackId: null,
          selectedDeviceId: null,
          selectedModelId: null,
          preFocusCameraState: null,
        })),

      getIsDirty: () => {
        const isSyncing = get().isSyncingPorts;
        const impDirty = get()._importDirty;
        if (isSyncing) return false;

        const {
          racks,
          importedModels,
          nodes,
          baselineNodes,
          registeredDevices,
          baselineRegisteredDevices,
          nodeEnvironments,
          baselineNodeEnvironments,
          _importDirty,
          layouts,
        } = get();
        if (_importDirty) return true;

        const baseNodes = baselineNodes || nodes;
        const baseRegDevices = baselineRegisteredDevices || registeredDevices;
        const baseNodeEnvs = baselineNodeEnvironments || nodeEnvironments;
        const baseLayouts = get().baselineLayouts || layouts;

        // Current room's active state might not be synced to `layouts` yet, so we merge it for comparison
        const currentLayouts = { ...layouts };
        if (get().activeSceneNodeId) {
          currentLayouts[get().activeSceneNodeId!] = { racks, importedModels };
        }

        const isDirtyNodes = JSON.stringify(nodes) !== JSON.stringify(baseNodes);
        const isDirtyRegDevices = JSON.stringify(registeredDevices) !== JSON.stringify(baseRegDevices);
        const isDirtyNodeEnvs = JSON.stringify(nodeEnvironments) !== JSON.stringify(baseNodeEnvs);
        const isDirtyLayouts = !layoutsEqual(currentLayouts, baseLayouts);

        const isDirty = isDirtyNodes || isDirtyRegDevices || isDirtyNodeEnvs || isDirtyLayouts;

        if (isDirty) {
          console.log("getIsDirty => TRUE");
          if (isDirtyNodes) console.log("- nodes changed", { current: nodes, base: baseNodes });
          if (isDirtyRegDevices) console.log("- registeredDevices changed", { current: registeredDevices, base: baseRegDevices });
          if (isDirtyNodeEnvs) console.log("- nodeEnvironments changed", { current: nodeEnvironments, base: baseNodeEnvs });
          if (isDirtyLayouts) console.log("- layouts changed", { current: currentLayouts, base: baseLayouts });
        }

        return isDirty;

      },

      getDirtyNodeIds: () => {
        const dirtyIds = new Set<string>();
        const {
          racks, importedModels, nodes, nodeEnvironments, layouts, activeSceneNodeId,
          baselineNodes, baselineNodeEnvironments, baselineLayouts
        } = get();

        const baseNodes = baselineNodes || nodes;
        const baseNodeEnvs = baselineNodeEnvironments || nodeEnvironments;
        const baseLayouts = baselineLayouts || layouts;

        // 1. Check for node hierarchy/name changes or new nodes
        const baseNodesMap = new Map(baseNodes.map(n => [n.nodeId, n]));
        const currentNodesMap = new Map(nodes.map(n => [n.nodeId, n]));

        nodes.forEach(n => {
          const base = baseNodesMap.get(n.nodeId);
          if (!base || JSON.stringify(n) !== JSON.stringify(base)) {
            dirtyIds.add(n.nodeId); // Mark the node itself as dirty

            // If it's a new node or moved node, mark the affected parents as dirty
            if (!base) {
              if (n.parentId) dirtyIds.add(n.parentId);
            } else if (base.parentId !== n.parentId) {
              if (base.parentId) dirtyIds.add(base.parentId);
              if (n.parentId) dirtyIds.add(n.parentId);
            }
          }
        });

        // Check for deleted nodes
        baseNodes.forEach(base => {
          if (!currentNodesMap.has(base.nodeId)) {
            // Node was deleted, mark its parent as dirty
            if (base.parentId) dirtyIds.add(base.parentId);
          }
        });

        // 2. Check for environment changes
        Object.keys(nodeEnvironments).forEach(nodeId => {
          if (JSON.stringify(nodeEnvironments[nodeId]) !== JSON.stringify(baseNodeEnvs[nodeId] || {})) {
            dirtyIds.add(nodeId);
          }
        });

        // 3. Check for layout changes
        const currentLayouts = { ...layouts };
        if (activeSceneNodeId) {
          currentLayouts[activeSceneNodeId] = { racks, importedModels };
        }

        Object.keys(currentLayouts).forEach(nodeId => {
          if (!baseLayouts[nodeId] || !layoutsEqual(currentLayouts[nodeId], baseLayouts[nodeId])) {
            dirtyIds.add(nodeId);
          }
        });


        return dirtyIds;
      },

      resetAllData: () => {
        set({
          racks: [],
          importedModels: [],
          nodes: [{ nodeId: ROOT_NODE_ID, parentId: null, name: "STN", type: "root", order: 0 }],
          layouts: {},
          nodeEnvironments: {},
          registeredDevices: [],
          activeNodeId: null,
          activeSceneNodeId: null,
          pinnedNodeId: null,
          focusedRackId: null,
          selectedRackId: null,
          selectedDeviceId: null,
          selectedModelId: null,
          undoStack: [],
          redoStack: [],
          baselineRacks: [],
          baselineModels: [],
          baselineNodes: [{ nodeId: ROOT_NODE_ID, parentId: null, name: "STN", type: "root", order: 0 }],
          baselineRegisteredDevices: [],
          baselineNodeEnvironments: {},
          baselineLayouts: {},
          baselineActiveNodeId: null,
          baselineActiveSceneNodeId: null,
          _importDirty: false,
        });
      },



      pushUndoState: () => {
        const { isEditMode, racks, importedModels, nodes, registeredDevices, undoStack } = get();
        if (!isEditMode) return;

        const { racks: r, importedModels: m, nodes: n, registeredDevices: rd } = structuredClone({ racks, importedModels, nodes, registeredDevices });
        const newEntry = { racks: r, importedModels: m, nodes: n, registeredDevices: rd };

        set({
          undoStack: [...undoStack, newEntry].slice(-50), // Limit to 50 entries
          redoStack: [], // Clear redo stack on new action
        });
      },

      undo: () => {
        const { isEditMode, undoStack, redoStack, racks, importedModels, nodes, registeredDevices } = get();
        if (!isEditMode || undoStack.length === 0) return;

        const newStack = [...undoStack];
        const prevState = newStack.pop();

        if (prevState) {
          const currentState = { racks, importedModels, nodes, registeredDevices };
          set({
            racks: prevState.racks,
            importedModels: prevState.importedModels,
            nodes: prevState.nodes,
            registeredDevices: prevState.registeredDevices,
            undoStack: newStack,
            redoStack: [...redoStack, currentState].slice(-50),
          });
        }
      },

      redo: () => {
        const { isEditMode, undoStack, redoStack, racks, importedModels, nodes, registeredDevices } = get();
        if (!isEditMode || redoStack.length === 0) return;

        const newRedoStack = [...redoStack];
        const nextState = newRedoStack.pop();

        if (nextState) {
          const currentState = { racks, importedModels, nodes, registeredDevices };
          set({
            racks: nextState.racks,
            importedModels: nextState.importedModels,
            nodes: nextState.nodes,
            registeredDevices: nextState.registeredDevices,
            undoStack: [...undoStack, currentState].slice(-50),
            redoStack: newRedoStack,
          });
        }
      },

      saveChanges: () => {
        const {
          pendingAction,
          racks,
          importedModels,
          activeSceneNodeId,
          layouts,
          expandNodePath,
        } = get();

        // 1. Save current state and clear flags
        const updatedLayouts = activeSceneNodeId
          ? {
            ...layouts,
            [activeSceneNodeId]: { racks, importedModels },
          }
          : layouts;

        // Phase 3-A: 단일 structuredClone으로 baseline 스냅샷
        const { nodes: currentNodes } = get();
        try {
          const snapshot = structuredClone({ racks, importedModels, nodes: currentNodes, registeredDevices: get().registeredDevices, nodeEnvironments: get().nodeEnvironments, layouts: updatedLayouts });
          console.log("saveChanges snapshot created:", snapshot);

          set({
            layouts: updatedLayouts,
            baselineRacks: snapshot.racks,
            baselineModels: snapshot.importedModels,
            baselineNodes: snapshot.nodes,
            baselineRegisteredDevices: snapshot.registeredDevices,
            baselineNodeEnvironments: snapshot.nodeEnvironments,
            baselineLayouts: snapshot.layouts,
            baselineActiveNodeId: get().activeNodeId,
            baselineActiveSceneNodeId: get().activeSceneNodeId,
            undoStack: [],
            redoStack: [],
            showUnsavedDialog: false,
            pendingAction: null,
            _importDirty: false,
          });
          console.log("saveChanges set complete.");
        } catch (e) {
          console.error("saveChanges error:", e);
        }

        // 2. Execute pending action DIRECTLY (bypass dirty checks since we just saved)
        if (pendingAction) {
          if (pendingAction.type === "node") {
            const targetNodeId = pendingAction.value;
            expandNodePath(targetNodeId);
            const currentLayouts = get().layouts;

            const targetNode = get().nodes.find((n) => n.nodeId === targetNodeId);
            const isRoom = !targetNode || targetNode.type === "room" || targetNode.type === "root";

            const newNodeLayout = isRoom
              ? (targetNodeId ? currentLayouts[targetNodeId] || { racks: [], importedModels: [] } : { racks: [], importedModels: [] })
              : { racks: get().racks, importedModels: get().importedModels };

            // Phase 3-A: 단일 structuredClone으로 새 노드 baseline 스냅샷
            const newSnap = structuredClone({
              racks: newNodeLayout.racks,
              importedModels: newNodeLayout.importedModels,
              nodes: get().nodes,
              registeredDevices: get().registeredDevices,
            });

            const nodeEnv = (targetNodeId && get().nodeEnvironments[targetNodeId]) || {};
            const cyberSpaceConfig = {
              ...(get().csIsLightMode ? LIGHT_THEME_CYBER_SPACE_CONFIG : DEFAULT_CYBER_SPACE_CONFIG),
              ...nodeEnv,
              csIsLightMode: get().csIsLightMode
            };

            set({
              ...cyberSpaceConfig,
              activeNodeId: targetNodeId,
              activeSceneNodeId: isRoom ? targetNodeId : get().activeSceneNodeId,
              racks: newNodeLayout.racks,
              importedModels: newNodeLayout.importedModels,
              baselineRacks: newSnap.racks,
              baselineModels: newSnap.importedModels,
              baselineNodes: newSnap.nodes,
              baselineRegisteredDevices: newSnap.registeredDevices,
              baselineActiveNodeId: targetNodeId,
              baselineActiveSceneNodeId: isRoom ? targetNodeId : get().activeSceneNodeId,
              undoStack: [],
              redoStack: [],
              selectedRackId: null,
              focusedRackId: null,
              selectedDeviceId: null,
              isDragging: false,
              draggingRackId: null,
              dragPosition: null,
              dragOffset: null,
              draggingModelId: null,
              modelDragPosition: null,
              modelDragOffset: null,
              preFocusCameraState: null,
              triggerFitToScene: get().triggerFitToScene + 1,
            });
          } else if (pendingAction.type === "editMode") {
            get().setIsEditMode(pendingAction.value);
          }
        }
      },

      discardChanges: () => {
        const {
          pendingAction,
          baselineRacks,
          baselineModels,
          baselineNodes,
          baselineRegisteredDevices,
          baselineNodeEnvironments,
          baselineLayouts,
          baselineActiveNodeId,
          baselineActiveSceneNodeId,
        } = get();

        if (baselineRacks && baselineModels && baselineNodes && baselineRegisteredDevices) {
          // Restore from baseline
          // Phase 3-A: 단일 structuredClone으로 복원
          const restored = structuredClone({
            racks: baselineRacks,
            importedModels: baselineModels,
            nodes: baselineNodes,
            registeredDevices: baselineRegisteredDevices
          });
          const restoredNodeEnvs = baselineNodeEnvironments ? structuredClone(baselineNodeEnvironments) : get().nodeEnvironments;
          const restoredLayouts = baselineLayouts ? structuredClone(baselineLayouts) : get().layouts;

          // Re-apply the active node's CyberSpace config from restored environments
          const restoredActiveNodeId = baselineActiveNodeId || get().pinnedNodeId || (restored.nodes[0] ? restored.nodes[0].nodeId : null);
          const nodeEnv = (restoredActiveNodeId && restoredNodeEnvs[restoredActiveNodeId]) || {};
          const cyberSpaceConfig = {
            ...(get().csIsLightMode ? LIGHT_THEME_CYBER_SPACE_CONFIG : DEFAULT_CYBER_SPACE_CONFIG),
            ...nodeEnv,
            csIsLightMode: get().csIsLightMode
          };

          set({
            ...cyberSpaceConfig,
            activeNodeId: restoredActiveNodeId,
            activeSceneNodeId: baselineActiveSceneNodeId || restoredActiveNodeId,
            racks: restored.racks,
            importedModels: restored.importedModels,
            nodes: restored.nodes,
            registeredDevices: restored.registeredDevices,
            nodeEnvironments: restoredNodeEnvs,
            layouts: restoredLayouts,
            undoStack: [],
            redoStack: [],
            showUnsavedDialog: false,
            pendingAction: null,
            _importDirty: false,
          });

          // If we are discarding while in a node, ensure layouts map is also refreshed if it was used as runtime cache
          if (get().activeSceneNodeId) {
            // state.racks/importedModels는 이미 위 set()에서 restored 값으로 업데이트됨
            set((state) => ({
              layouts: {
                ...state.layouts,
                [state.activeSceneNodeId!]: {
                  racks: state.racks,
                  importedModels: state.importedModels,
                },
              },
            }));
          }
        } else {
          set({
            undoStack: [],
            redoStack: [],
            showUnsavedDialog: false,
            pendingAction: null,
            _importDirty: false,
          });
        }

        if (pendingAction) {
          if (pendingAction.type === "node") {
            const targetNodeId = pendingAction.value;
            get().expandNodePath(targetNodeId);
            const currentLayouts = get().layouts;
            const newNodeLayout = targetNodeId
              ? currentLayouts[targetNodeId] || { racks: [], importedModels: [] }
              : { racks: [], importedModels: [] };

            // Phase 3-A: 단일 structuredClone으로 discard 후 새 노드 baseline 스냅샷
            const discardSnap = structuredClone({
              racks: newNodeLayout.racks,
              importedModels: newNodeLayout.importedModels,
              nodes: get().nodes,
              registeredDevices: get().registeredDevices,
            });

            const nodeEnv = (targetNodeId && get().nodeEnvironments[targetNodeId]) || {};
            const cyberSpaceConfig = {
              ...(get().csIsLightMode ? LIGHT_THEME_CYBER_SPACE_CONFIG : DEFAULT_CYBER_SPACE_CONFIG),
              ...nodeEnv,
              csIsLightMode: get().csIsLightMode
            };

            set({
              ...cyberSpaceConfig,
              activeNodeId: targetNodeId,
              racks: newNodeLayout.racks,
              importedModels: newNodeLayout.importedModels,
              baselineRacks: discardSnap.racks,
              baselineModels: discardSnap.importedModels,
              baselineNodes: discardSnap.nodes,
              baselineRegisteredDevices: discardSnap.registeredDevices,
              undoStack: [],
              redoStack: [],
              selectedRackId: null,
              focusedRackId: null,
              selectedDeviceId: null,
              isDragging: false,
              draggingRackId: null,
              dragPosition: null,
              dragOffset: null,
              draggingModelId: null,
              modelDragPosition: null,
              modelDragOffset: null,
              preFocusCameraState: null,
              triggerFitToScene: get().triggerFitToScene + 1,
            });
          } else if (pendingAction.type === "editMode") {
            get().setIsEditMode(pendingAction.value);
          }
        }
      },

      cancelConfirmation: () => {
        set({ showUnsavedDialog: false, pendingAction: null });
      },

      setCameraRef: (camera, controls) =>
        set({ _cameraRef: camera, _controlsRef: controls }),
      setHoveredRack: (id) => set({ hoveredRackId: id }),
      setActiveNode: (nodeId) => {
        const { expandNodePath, layouts, nodes, racks, importedModels, activeSceneNodeId } = get();

        // 1. Update the current node's layout in the central layouts object BEFORE switching
        const updatedLayouts = { ...layouts };
        if (activeSceneNodeId) {
          updatedLayouts[activeSceneNodeId] = { racks, importedModels };
        }

        expandNodePath(nodeId);

        const targetNode = nodes.find((n) => n.nodeId === nodeId);
        const isRoom = !targetNode || targetNode.type === "room" || targetNode.type === "root";

        // Switch Layout ONLY if it's a room/root
        const newNodeLayout = isRoom
          ? (nodeId ? updatedLayouts[nodeId] || { racks: [], importedModels: [] } : { racks: [], importedModels: [] })
          : { racks, importedModels }; // Keep current layout for groups

        // Fetch Node-specific CyberSpace Environment or Default
        const nodeEnv = (nodeId && get().nodeEnvironments[nodeId]) || {};
        const cyberSpaceConfig = {
          ...(get().csIsLightMode ? LIGHT_THEME_CYBER_SPACE_CONFIG : DEFAULT_CYBER_SPACE_CONFIG),
          ...nodeEnv,
          csIsLightMode: get().csIsLightMode
        };

        set({
          ...cyberSpaceConfig,
          layouts: updatedLayouts,
          activeNodeId: nodeId,
          activeSceneNodeId: isRoom ? nodeId : activeSceneNodeId,
          racks: newNodeLayout.racks,
          importedModels: newNodeLayout.importedModels,
          // We NO LONGER update baselines here because editing is now project-wide.
          // Baselines are only updated when the user explicitly clicks "Save".

          undoStack: [], // Clear undo stack on node switch to prevent mixing node states
          redoStack: [], // Clear redo stack on node switch
          selectedRackId: null,
          focusedRackId: null,
          selectedDeviceId: null,
          isDragging: false,
          draggingRackId: null,
          dragPosition: null,
          dragOffset: null,
          draggingModelId: null,
          modelDragPosition: null,
          modelDragOffset: null,
          preFocusCameraState: null,
          triggerFitToScene: get().triggerFitToScene + 1,
        });
      },
      setImportExportModalRackId: (id) => set({ importExportModalRackId: id }),
      setPinnedNode: (nodeId) => {
        set({ pinnedNodeId: nodeId });
      },
      setDeviceRegistrationModalOpen: (open) =>
        set({ deviceRegistrationModalOpen: open }),
      setModelRegistrationModalOpen: (open) =>
        set({ modelRegistrationModalOpen: open }),

      // ── Custom Model / Card CRUD ─────────────────────────────────────────
      addCustomModel: (modelData) => {
        const modelId = `custom-model-${crypto.randomUUID().slice(0, 8)}`;
        const newModel: CustomEquipmentModel = { ...modelData, modelId };
        set((state) => {
          const newModels = [...state.customModels, newModel];
          saveCustomModelsToProject(newModels);
          return { customModels: newModels };
        });
        return modelId;
      },

      updateCustomModel: (modelId, updates) => {
        set((state) => {
          const oldModel = state.customModels.find((m) => m.modelId === modelId);
          if (!oldModel) return state;

          const updatedModel = { ...oldModel, ...updates };
          const customModels = state.customModels.map((m) =>
            m.modelId === modelId ? updatedModel : m
          );

          // Helper to apply model updates to a list of devices
          const applyToDevices = (devices: RegisteredDevice[]) => {
            return devices.map((dev) => {
              let matchedVariant = oldModel.variants?.find((v) => {
                const oldVariantName = v.variantName === "기본타입" ? oldModel.modelName : `${oldModel.modelName} ${v.variantName}`;
                return dev.modelName === oldVariantName;
              });
              if (!matchedVariant && dev.modelName === oldModel.modelName) {
                matchedVariant = oldModel.variants?.[0];
              }

              if (matchedVariant || dev.modelName === oldModel.modelName) {
                const newVariant = updatedModel.variants?.find(v => v.variantId === matchedVariant?.variantId)
                  || updatedModel.variants?.find(v => v.variantName === matchedVariant?.variantName)
                  || updatedModel.variants?.[0];

                const newDevModelName = newVariant
                  ? (newVariant.variantName === "기본타입" ? updatedModel.modelName : `${updatedModel.modelName} ${newVariant.variantName}`)
                  : updatedModel.modelName;

                return {
                  ...dev,
                  modelName: newDevModelName,
                  size: updatedModel.unit ?? dev.size,
                  insertedCards: newVariant?.insertedCards || [],
                };
              }
              return dev;
            });
          };

          // Helper to apply model updates to racks
          const applyToRacks = (racksList: Rack[]) => {
            return racksList.map((rack) => {
              let changed = false;
              const newDevices = rack.devices.map((dev) => {
                let matchedVariant = oldModel.variants?.find((v) => {
                  const oldVariantName = v.variantName === "기본타입" ? oldModel.modelName : `${oldModel.modelName} ${v.variantName}`;
                  return dev.modelName === oldVariantName;
                });
                if (!matchedVariant && dev.modelName === oldModel.modelName) {
                  matchedVariant = oldModel.variants?.[0];
                }

                if (matchedVariant || dev.modelName === oldModel.modelName) {
                  changed = true;
                  const newVariant = updatedModel.variants?.find(v => v.variantId === matchedVariant?.variantId)
                    || updatedModel.variants?.find(v => v.variantName === matchedVariant?.variantName)
                    || updatedModel.variants?.[0];
                  const newDevModelName = newVariant
                    ? (newVariant.variantName === "기본타입" ? updatedModel.modelName : `${updatedModel.modelName} ${newVariant.variantName}`)
                    : updatedModel.modelName;

                  return {
                    ...dev,
                    modelName: newDevModelName,
                    size: updatedModel.unit ?? dev.size,
                    insertedCards: newVariant?.insertedCards || [],
                  };
                }
                return dev;
              });
              return changed ? { ...rack, devices: newDevices } : rack;
            });
          };

          // 1. 현재 상태 업데이트
          const registeredDevices = applyToDevices(state.registeredDevices);
          const racks = applyToRacks(state.racks);

          const layouts = { ...state.layouts };
          if (state.activeNodeId && state.layouts[state.activeNodeId]) {
            layouts[state.activeNodeId] = {
              ...layouts[state.activeNodeId],
              racks: applyToRacks(layouts[state.activeNodeId].racks),
            };
          }

          // 2. Baseline 상태 동기화 (Edit Mode의 Unsaved 상태를 트리거하지 않도록)
          const baselineRegisteredDevices = state.baselineRegisteredDevices
            ? applyToDevices(state.baselineRegisteredDevices)
            : state.baselineRegisteredDevices;

          const baselineRacks = state.baselineRacks
            ? applyToRacks(state.baselineRacks)
            : state.baselineRacks;

          const baselineLayouts = state.baselineLayouts ? { ...state.baselineLayouts } : state.baselineLayouts;
          if (baselineLayouts) {
            Object.keys(baselineLayouts).forEach((nodeId) => {
              if (baselineLayouts[nodeId]) {
                baselineLayouts[nodeId] = {
                  ...baselineLayouts[nodeId],
                  racks: applyToRacks(baselineLayouts[nodeId].racks),
                };
              }
            });
          }

          saveCustomModelsToProject(customModels);
          return {
            customModels,
            registeredDevices,
            racks,
            layouts,
            baselineRegisteredDevices,
            baselineRacks,
            baselineLayouts
          };
        });
      },

      removeCustomModel: (modelId) => {
        set((state) => {
          const newModels = state.customModels.filter((m) => m.modelId !== modelId);
          saveCustomModelsToProject(newModels);
          return { customModels: newModels };
        });
      },

      addCustomCard: (cardData) => {
        const cardId = `custom-card-${crypto.randomUUID().slice(0, 8)}`;
        const newCard: CustomCardDefinition = { ...cardData, cardId };
        set((state) => ({
          customCards: [...state.customCards, newCard],
        }));
        return cardId;
      },

      removeCustomCard: (cardId) => {
        set((state) => ({
          customCards: state.customCards.filter((c) => c.cardId !== cardId),
        }));
      },

      removeDefaultTemplate: (modelName) => {
        set((state) => ({
          deletedDefaultTemplates: [...state.deletedDefaultTemplates, modelName],
        }));
      },

      restoreDefaultTemplate: (modelName) => {
        set((state) => ({
          deletedDefaultTemplates: state.deletedDefaultTemplates.filter((n) => n !== modelName),
        }));
      },
      setHighlightedDevice: (id, duration) => {
        const { blinkTimeoutId } = get();
        if (blinkTimeoutId) {
          window.clearTimeout(blinkTimeoutId);
        }

        set({ highlightedDeviceId: id, blinkTimeoutId: null });

        if (id && duration) {
          const timeoutId = window.setTimeout(() => {
            if (get().highlightedDeviceId === id) {
              set({ highlightedDeviceId: null, blinkTimeoutId: null });
            }
          }, duration);
          set({ blinkTimeoutId: timeoutId as unknown as number });
        }
      },

      locateDevice: (registeredDeviceId) => {
        const {
          layouts,
          setActiveNode,
          selectRack,
          focusRack,
          setHighlightedDevice,
        } = get();

        let foundNodeId: string | null = null;
        let foundRackId: string | null = null;
        let foundDeviceId: string | null = null;

        // Global search across all node layouts
        for (const [nodeId, layout] of Object.entries(layouts)) {
          if (!layout.racks) continue;
          for (const rack of layout.racks) {
            const placed = rack.devices.find(
              (d) => d.deviceId === registeredDeviceId,
            );
            if (placed) {
              foundNodeId = nodeId;
              foundRackId = rack.rackId;
              foundDeviceId = placed.itemId; // Use itemId for 3D highlight matching
              break;
            }
          }
          if (foundNodeId) break;
        }

        if (foundNodeId && foundRackId && foundDeviceId) {
          // 1. Switch Node if needed
          if (get().activeNodeId !== foundNodeId) {
            setActiveNode(foundNodeId);
          }

          // 2. Select and Focus Rack
          selectRack(foundRackId);
          focusRack(foundRackId);

          // 3. Highlight Device
          setHighlightedDevice(foundDeviceId, 2500);

          return true;
        }

        return false;
      },
      setShowEquipmentInTree: (show) => set({ showEquipmentInTree: show }),

      addRegisteredDevice: (deviceData) => {
        get().pushUndoState();
        // Generate current timestamp in 'YYYY-MM-DD HH:mm:ss' format
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000; // offset in milliseconds
        const localISOTime = (new Date(now.getTime() - tzOffset)).toISOString().replace('T', ' ').substring(0, 19);

        const newDevice: RegisteredDevice = {
          ...deviceData,
          regDate: deviceData.regDate || localISOTime,
          deviceId: crypto.randomUUID(),
        };
        set((state) => ({
          registeredDevices: [...state.registeredDevices, newDevice],
        }));
      },

      updateRegisteredDevice: (id, updates, skipUndo = false) => {
        if (!skipUndo) get().pushUndoState();
        // Generate current timestamp in 'YYYY-MM-DD HH:mm:ss' format
        const now = new Date();
        const tzOffset = now.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(now.getTime() - tzOffset)).toISOString().replace('T', ' ').substring(0, 19);

        set((state) => {
          const updatedRegDevices = state.registeredDevices.map((d) =>
            d.deviceId === id ? { ...d, ...updates, modiDate: localISOTime } : d,
          );

          // Phase 4: 해당 device가 없는 rack은 참조 유지 (불필요한 복사 방지)
          let racksChanged = false;
          const updatedRacks = state.racks.map((rack) => {
            const hasTarget = rack.devices.some(d => d.deviceId === id);
            if (!hasTarget) return rack; // 원래 참조 유지
            racksChanged = true;
            return {
              ...rack,
              devices: rack.devices.map((device) => {
                if (device.deviceId === id) {
                  return {
                    ...device,
                    title: updates.title ?? device.title,
                    IPAddr: updates.IPAddr ?? device.IPAddr,
                    macAddr: updates.macAddr ?? device.macAddr,
                    vendor: updates.vendor ?? device.vendor,
                    modelName: updates.modelName ?? device.modelName,
                    size: updates.size ?? device.size,
                    insertedCards: updates.insertedCards !== undefined ? updates.insertedCards : device.insertedCards,
                    insertedModules: updates.insertedModules !== undefined ? updates.insertedModules : device.insertedModules,
                    defaultViewSide: updates.defaultViewSide !== undefined ? updates.defaultViewSide : device.defaultViewSide,
                    portStates: updates.generatedPorts
                      ? updates.generatedPorts.map(gp => {
                        const ex = device.portStates.find(p => p.portId === gp.realPortNumber);
                        if (ex) return { ...ex, portName: gp.portType, portNumber: gp.realPortNumber };
                        return { portId: gp.realPortNumber, portNumber: gp.realPortNumber, portName: gp.portType, status: "normal" } as PortState;
                      })
                      : device.portStates,
                  };
                }
                return device;
              }),
            };
          });

          return {
            registeredDevices: updatedRegDevices,
            racks: racksChanged ? updatedRacks : state.racks,
            layouts: state.activeNodeId && racksChanged
              ? {
                ...state.layouts,
                [state.activeNodeId]: {
                  ...state.layouts[state.activeNodeId],
                  racks: updatedRacks,
                },
              }
              : state.layouts,
          };
        });
      },

      removeRegisteredDevice: (id) => {
        get().pushUndoState();
        set((state) => {
          const updatedRacks = state.racks.map((rack) => ({
            ...rack,
            devices: rack.devices.filter((d) => d.deviceId !== id),
          }));
          return {
            registeredDevices: state.registeredDevices.filter(
              (d) => d.deviceId !== id,
            ),
            racks: updatedRacks,
            layouts: state.activeNodeId
              ? {
                ...state.layouts,
                [state.activeNodeId]: {
                  ...state.layouts[state.activeNodeId],
                  racks: updatedRacks,
                },
              }
              : state.layouts,
          };
        });
      },

      upsertRegisteredDevices: (devices) => {
        get().pushUndoState();
        let added = 0;
        let updated = 0;

        set((state) => {
          const existing = [...state.registeredDevices];
          devices.forEach((newDev) => {
            // Identity Matching Rule (Strictly Node-Scoped):
            // 1. Same Node + Same MAC (Strong match)
            // 2. Same Node + Same Name + Same IP (Secondary match for attribute updates)
            const matchIdx = existing.findIndex(
              (ex) =>
                ex.deviceGroupId === newDev.deviceGroupId &&
                (ex.macAddr === newDev.macAddr ||
                  (ex.title === newDev.title && ex.IPAddr === newDev.IPAddr)),
            );

            if (matchIdx >= 0) {
              existing[matchIdx] = { ...existing[matchIdx], ...newDev };
              updated++;
            } else {
              existing.push({ ...newDev, deviceId: crypto.randomUUID() });
              added++;
            }
          });
          return { registeredDevices: existing };
        });

        return { added, updated };
      },

      hoveredDevice: null,
      setHoveredDevice: (payload) => set({ hoveredDevice: payload }),

      addRack: (rackSize, position = [0, 0], width = RACK_WIDTH_STANDARD) => {
        const { racks, isEditMode, _cameraRef, pushUndoState } = get();

        if (isEditMode) {
          pushUndoState();
        }

        let spawnPos: [number, number];
        if (position) {
          spawnPos = position;
        } else if (_cameraRef) {
          const raycaster = new Raycaster();
          const center = new Vector2(0, 0);
          raycaster.setFromCamera(center, _cameraRef);
          const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
          const hitPoint = new Vector3();
          if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
            const gridX = Math.round((hitPoint.x / GRID_SPACING) * 15) / 15;
            const gridZ = Math.round((hitPoint.z / GRID_SPACING) * 15) / 15;
            spawnPos = [gridX, gridZ];
          } else {
            const dir = new Vector3();
            _cameraRef.getWorldDirection(dir);
            const fallback = _cameraRef.position.clone().add(dir.multiplyScalar(5));
            const gridX = Math.round((fallback.x / GRID_SPACING) * 15) / 15;
            const gridZ = Math.round((fallback.z / GRID_SPACING) * 15) / 15;
            spawnPos = [gridX, gridZ];
          }
        } else {
          spawnPos = [0, 0];
        }

        const { activeNodeId, nodes } = get();
        const activeNode = nodes.find(n => n.nodeId === activeNodeId);
        if (!activeNodeId || activeNode?.type !== "room") {
          get().showToast("전산실을 선택하거나 생성해주세요.", "error");
          return;
        }
        const nodeRacks = racks.filter((r) => r.mapId === activeNodeId);

        let finalPos = spawnPos;
        if (checkCollision(nodeRacks, null, spawnPos, width)) {
          // 기존 랙들의 실제 크기를 기반으로 정확히 옆에 붙는 후보 위치를 생성
          const newDims = getEffectiveDimensions(width, 180);
          const candidates: [number, number][] = [];

          for (const other of nodeRacks) {
            const otherDims = getEffectiveDimensions(
              other.width,
              other.orientation ?? 180,
            );
            const ox = other.position[0] * GRID_SPACING;
            const oz = other.position[1] * GRID_SPACING;

            const halfSumX = (otherDims.effectiveWidth + newDims.effectiveWidth) / 2;
            const halfSumZ = (otherDims.effectiveDepth + newDims.effectiveDepth) / 2;
            const GAP = 0.01; // 최소 이격 거리

            // 좌/우/앞/뒤로 딱 붙는 후보들
            candidates.push(
              [(ox + halfSumX + GAP) / GRID_SPACING, other.position[1]],
              [(ox - halfSumX - GAP) / GRID_SPACING, other.position[1]],
              [other.position[0], (oz + halfSumZ + GAP) / GRID_SPACING],
              [other.position[0], (oz - halfSumZ - GAP) / GRID_SPACING],
            );
          }

          // 스폰 위치에서 가장 가까운 후보부터 탐색
          candidates.sort((a, b) => {
            const da =
              Math.abs(a[0] - spawnPos[0]) + Math.abs(a[1] - spawnPos[1]);
            const db =
              Math.abs(b[0] - spawnPos[0]) + Math.abs(b[1] - spawnPos[1]);
            return da - db;
          });

          let found = false;
          for (const candidate of candidates) {
            if (!checkCollision(nodeRacks, null, candidate, width)) {
              finalPos = candidate;
              found = true;
              break;
            }
          }

          // 후보 탐색 실패 시 기존 그리드 탐색 fallback
          if (!found) {
            for (let radius = 1; radius <= 20 && !found; radius++) {
              for (const dx of [-radius, 0, radius]) {
                for (const dz of [-radius, 0, radius]) {
                  if (dx === 0 && dz === 0) continue;
                  const candidate: [number, number] = [
                    spawnPos[0] + (dx * width) / GRID_SPACING,
                    spawnPos[1] + (dz * (newDims.effectiveDepth + 0.02)) / GRID_SPACING,
                  ];
                  if (!checkCollision(nodeRacks, null, candidate, width)) {
                    finalPos = candidate;
                    found = true;
                    break;
                  }
                }
                if (found) break;
              }
            }
          }
        }

        const newRack: Rack = {
          rackId: crypto.randomUUID(),
          mapId: activeNodeId!,
          rackSize,
          width,
          position: finalPos,
          orientation: 180,
          devices: [],
        };

        if (isEditMode) {
          set((state) => ({
            racks: [...state.racks, newRack],
            selectedRackId: newRack.rackId,
            layouts: activeNodeId
              ? {
                ...state.layouts,
                [activeNodeId]: {
                  ...(state.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  racks: [...state.racks, newRack],
                },
              }
              : state.layouts,
          }));
        } else {
          set((state) => ({
            racks: [...state.racks, newRack],
            layouts: activeNodeId
              ? {
                ...state.layouts,
                [activeNodeId]: {
                  ...(state.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  racks: [...state.racks, newRack],
                },
              }
              : state.layouts,
          }));
        }
      },

      moveRack: (id, newPosition) => {
        const { racks, showToast } = get();
        const rack = racks.find((r) => r.rackId === id);
        if (!rack) return false;

        const nodeRacks = racks.filter((r) => r.mapId === rack.mapId);

        if (
          checkCollision(nodeRacks, id, newPosition, rack.width, rack.orientation)
        ) {
          showToast("겹치는 위치에는 렉을 배치할 수 없습니다.", "error");
          return false;
        }

        const updatedRacks = racks.map((r) =>
          r.rackId === id ? { ...r, position: newPosition } : r,
        );
        set((state) => ({
          racks: updatedRacks,
          layouts: rack.mapId
            ? {
              ...state.layouts,
              [rack.mapId]: { ...state.layouts[rack.mapId], racks: updatedRacks },
            }
            : state.layouts,
        }));
        return true;
      },

      deleteRack: (id) => {
        const { isEditMode, pushUndoState } = get();
        if (isEditMode) pushUndoState();
        set((state) => {
          const updatedRacks = state.racks.filter((r) => r.rackId !== id);
          const rackToDelete = state.racks.find((r) => r.rackId === id);
          const nid = rackToDelete?.mapId;

          return {
            racks: updatedRacks,
            selectedRackId:
              state.selectedRackId === id ? null : state.selectedRackId,
            focusedRackId: state.focusedRackId === id ? null : state.focusedRackId,
            layouts: nid
              ? {
                ...state.layouts,
                [nid]: { ...state.layouts[nid], racks: updatedRacks },
              }
              : state.layouts,
          };
        });
      },

      selectRack: (id) => {
        const state = get();
        if (state.isDragging && state.draggingRackId && state.dragPosition) {
          const gridX =
            Math.round((state.dragPosition[0] / GRID_SPACING) * 15) / 15;
          const gridZ =
            Math.round((state.dragPosition[1] / GRID_SPACING) * 15) / 15;
          state.endDrag(state.draggingRackId, [gridX, gridZ]);
        } else if (state.isDragging) {
          set({
            isDragging: false,
            draggingRackId: null,
            dragPosition: null,
            dragOffset: null,
          });
        }

        if (id && id === state.selectedRackId && state.focusedRackId) {
          return;
        }

        set({
          selectedRackId: id,
          focusedRackId: null,
          obstructingRackIds: [],
          selectedDeviceId: null,
          selectedModelId: id ? null : state.selectedModelId,
          hoveredDevice: null,
        });
      },
      selectDevice: (id, portId = null) =>
        set({ selectedDeviceId: id, highlightedPortId: portId, hoveredDevice: null }),
      focusRack: (id) => {
        const { _cameraRef, _controlsRef, preFocusCameraState } = get();

        // Capture state if starting focus and no state is saved yet
        if (id && !preFocusCameraState && _cameraRef && _controlsRef) {
          const pos = _cameraRef.position;
          const target = _controlsRef.target;
          set({
            preFocusCameraState: {
              position: [pos.x, pos.y, pos.z],
              target: [target.x, target.y, target.z],
              zoom: (_cameraRef as Camera & { zoom?: number }).zoom ?? 1,
            },
          });
        }

        set({ focusedRackId: id, obstructingRackIds: [] });
      },

      setObstructingRackIds: (ids) => {
        set({ obstructingRackIds: ids });
      },
      setPreFocusCameraState: (state) => set({ preFocusCameraState: state }),
      setDragging: (isDragging, rackId = null, offset = null) =>
        set({
          isDragging,
          draggingRackId: isDragging ? rackId : null,
          dragOffset: offset,
        }),
      updateDragPosition: (pos) => set({ dragPosition: pos }),

      endDrag: (id, newPosition) => {
        const { racks, isEditMode, pushUndoState } = get();
        const rack = racks.find((r) => r.rackId === id);
        if (!rack) return false;

        let finalPosition = [...newPosition] as [number, number];

        // Deadzone check for accidental micro-movements on click
        const distMoved = Math.sqrt(
          Math.pow(newPosition[0] - rack.position[0], 2) +
          Math.pow(newPosition[1] - rack.position[1], 2)
        );

        const nodeRacks = racks.filter((r) => r.mapId === rack.mapId);

        if (distMoved < 0.05) {
          finalPosition = [...rack.position];
        } else {
          const SNAP_THRESHOLD = 0.5;
          const worldX = newPosition[0] * GRID_SPACING;

          let xSnapped = false;
          for (const other of nodeRacks) {
            if (other.rackId === id) continue;
            // ── X축 스냅 (좌우로 나란히 붙이기): 같은 Z 행 ──
            if (Math.abs(other.position[1] - newPosition[1]) <= 0.1) {
              const otherWorldX = other.position[0] * GRID_SPACING;
              const gap =
                Math.abs(worldX - otherWorldX) - (rack.width + other.width) / 2;

              if (gap >= -0.1 && gap < SNAP_THRESHOLD) {
                const direction = worldX > otherWorldX ? 1 : -1;
                const RACK_GAP = 0.01;
                const snappedWorldX =
                  otherWorldX + (direction * (other.width + rack.width)) / 2 + (direction * RACK_GAP);
                finalPosition[0] = snappedWorldX / GRID_SPACING;
                finalPosition[1] = other.position[1]; // 완벽한 전후 정렬 (Align Z-axis)
                xSnapped = true;
                break;
              }
            }
          }

          // ── Z축 스냅 (앞뒤로 붙이기 / back-to-back): 같은 X 열 ──
          if (!xSnapped) {
            const worldZ = newPosition[1] * GRID_SPACING;
            const RACK_D = 1.0; // RACK_DEPTH 상수와 동일

            for (const other of nodeRacks) {
              if (other.rackId === id) continue;
              const otherWorldX = other.position[0] * GRID_SPACING;
              // 같은 X 열: X 거리가 두 랙 폭 절반의 합 이내
              if (
                Math.abs(worldX - otherWorldX) >
                (rack.width + other.width) / 2 + 0.1
              )
                continue;

              const otherWorldZ = other.position[1] * GRID_SPACING;
              const zGap =
                Math.abs(worldZ - otherWorldZ) - (RACK_D + RACK_D) / 2;

              if (zGap >= -0.1 && zGap < SNAP_THRESHOLD) {
                const direction = worldZ > otherWorldZ ? 1 : -1;
                const snappedWorldZ =
                  otherWorldZ + (direction * (RACK_D + RACK_D)) / 2;
                finalPosition[1] = snappedWorldZ / GRID_SPACING;
                finalPosition[0] = other.position[0]; // 완벽한 좌우 정렬 (Align X-axis)
                break;
              }
            }
          }
        }


        const colliding = checkCollision(
          nodeRacks,
          id,
          finalPosition,
          rack.width,
          rack.orientation,
        );
        const frontClearanceViolation = checkFrontClearanceViolation(
          nodeRacks,
          id,
          finalPosition,
          rack.orientation,
          rack.width,
        );

        if (colliding || frontClearanceViolation) {
          if (colliding) {
            get().showToast("다른 렉과 겹쳐서 배치할 수 없습니다.", "error");
          } else {
            get().showToast("앞쪽 유지보수 공간이 부족합니다.", "error");
          }
          set({
            isDragging: false,
            draggingRackId: null,
            dragPosition: null,
            dragOffset: null,
          });
          return false;
        }

        const hasMoved = !layoutsEqual(rack.position, finalPosition);

        if (hasMoved && isEditMode) {
          pushUndoState();
        }

        const newRacks = hasMoved
          ? racks.map((r) =>
            r.rackId === id ? { ...r, position: finalPosition } : r,
          )
          : racks;

        set({
          racks: newRacks,
          isDragging: false,
          draggingRackId: null,
          dragPosition: null,
          dragOffset: null,
        });
        return true;
      },

      updateRackOrientation: (id, orientation) => {
        const { racks, showToast, isEditMode, pushUndoState } = get();
        const rack = racks.find((r) => r.rackId === id);
        if (!rack) return;

        if (rack.orientation === orientation) return;

        if (isEditMode) pushUndoState();

        const nodeRacks = racks.filter((r) => r.mapId === rack.mapId);

        const frontClearanceViolation = checkFrontClearanceViolation(
          nodeRacks,
          id,
          rack.position,
          orientation,
          rack.width,
        );

        if (frontClearanceViolation) {
          showToast("해당 방향은 앞쪽 유지보수 공간이 부족합니다.", "error");
          return;
        }

        set((state) => {
          const updatedRacks = state.racks.map((r) =>
            r.rackId === id ? { ...r, orientation } : r,
          );
          return {
            racks: updatedRacks,
            layouts: rack.mapId
              ? {
                ...state.layouts,
                [rack.mapId]: {
                  ...state.layouts[rack.mapId],
                  racks: updatedRacks,
                },
              }
              : state.layouts,
          };
        });
      },

      setIsEditMode: (enabled: boolean) => {
        const {
          isDragging,
          draggingRackId,
          dragPosition,
          endDrag,
          getIsDirty,
          racks,
          importedModels,
        } = get();

        if (enabled) {
          // Entering Edit Mode: Snapshot current state as baseline
          // Phase 3-A: 단일 structuredClone으로 통합
          const editSnap = structuredClone({
            racks,
            importedModels,
            nodes: get().nodes,
            nodeEnvironments: get().nodeEnvironments,
            layouts: get().layouts,
            registeredDevices: get().registeredDevices
          });
          set({
            baselineRacks: editSnap.racks,
            baselineModels: editSnap.importedModels,
            baselineNodes: editSnap.nodes,
            baselineNodeEnvironments: editSnap.nodeEnvironments,
            baselineLayouts: editSnap.layouts,
            baselineRegisteredDevices: editSnap.registeredDevices,
            baselineActiveNodeId: get().activeNodeId,
            baselineActiveSceneNodeId: get().activeSceneNodeId,
            undoStack: [],
            redoStack: [],
            isEditMode: true,
            selectedRackId: null,
            focusedRackId: null,
            selectedModelId: null,
          });
          return;
        }

        // Exiting Edit Mode
        if (getIsDirty()) {
          set({
            showUnsavedDialog: true,
            pendingAction: { type: "editMode", value: false },
          });
          return;
        }

        if (isDragging && draggingRackId && dragPosition) {
          const gridX = Math.round((dragPosition[0] / GRID_SPACING) * 15) / 15;
          const gridZ = Math.round((dragPosition[1] / GRID_SPACING) * 15) / 15;
          endDrag(draggingRackId, [gridX, gridZ]);
        }

        set({
          isEditMode: false,
          baselineRacks: null,
          baselineModels: null,
          baselineNodes: null,
          baselineNodeEnvironments: null,
          baselineLayouts: null,
          baselineRegisteredDevices: null,
          baselineActiveNodeId: null,
          baselineActiveSceneNodeId: null,
          undoStack: [],
          redoStack: [],
          selectedRackId: null,
          focusedRackId: null,
          selectedModelId: null,
        });
      },

      addDevice: (rackId, deviceData) => {
        const { racks, isEditMode, pushUndoState } = get();
        const rack = racks.find((r) => r.rackId === rackId);
        if (!rack) return false;

        if (isEditMode) pushUndoState();

        if (
          deviceData.position < 1 ||
          deviceData.position + deviceData.size - 1 > rack.rackSize
        ) {
          return false;
        }

        const collision = rack.devices.some((d) => {
          const dStart = d.position;
          const dEnd = d.position + d.size - 1;
          const newStart = deviceData.position;
          const newEnd = deviceData.position + deviceData.size - 1;
          return dStart <= newEnd && dEnd >= newStart;
        });

        if (collision) {
          return false;
        }

        // Single-mount enforcement: block if already mounted anywhere in all layouts
        if (deviceData.deviceId) {
          const alreadyMounted = get().findExistingMount(deviceData.deviceId);
          if (alreadyMounted && alreadyMounted.rackId !== rackId) {
            // Caller must handle remount flow; store blocks silently
            return false;
          }
        }

        const newDevice: Device = {
          ...deviceData,
          itemId: crypto.randomUUID(),
          portStates: deviceData.portStates || [],
          insertedCards: deviceData.insertedCards,
          insertedModules: deviceData.insertedModules,
          defaultViewSide: deviceData.defaultViewSide,
        };

        const updatedRacks = racks.map((r) =>
          r.rackId === rackId ? { ...r, devices: [...r.devices, newDevice] } : r,
        );
        set((state) => ({
          racks: updatedRacks,
          layouts: rack.mapId
            ? {
              ...state.layouts,
              [rack.mapId]: { ...state.layouts[rack.mapId], racks: updatedRacks },
            }
            : state.layouts,
        }));
        return true;
      },

      findExistingMount: (registeredDeviceId) => {
        const { racks, layouts } = get();
        // Search active racks (current node)
        for (const rack of racks) {
          const found = rack.devices.find((d) => d.deviceId === registeredDeviceId);
          if (found) {
            return {
              rackId: rack.rackId,
              nodeId: rack.mapId,
              deviceId: found.deviceId || "",
              rackName:
                rack.rackTitle || `Rack-${rack.rackId.slice(0, 4).toUpperCase()}`,
            };
          }
        }
        // Search all layouts (other nodes)
        for (const [nodeId, layout] of Object.entries(layouts)) {
          if (!layout.racks) continue;
          for (const rack of layout.racks) {
            const found = rack.devices.find(
              (d) => d.deviceId === registeredDeviceId,
            );
            if (found) {
              return {
                rackId: rack.rackId,
                nodeId,
                deviceId: found.deviceId || "",
                rackName:
                  rack.rackTitle || `Rack-${rack.rackId.slice(0, 4).toUpperCase()}`,
              };
            }
          }
        }
        return null;
      },

      removeDevice: (rackId, targetId) => {
        const { isEditMode, pushUndoState } = get();
        if (isEditMode) pushUndoState();
        set((state) => {
          // Helper to remove device from a rack list
          const updateRacksList = (rList: Rack[]) =>
            rList.map((r) =>
              r.rackId === rackId
                ? {
                  ...r,
                  devices: r.devices.filter(
                    (d) => d.deviceId !== targetId && d.itemId !== targetId,
                  ),
                }
                : r,
            );

          // Update current active racks
          const updatedRacks = updateRacksList(state.racks);

          // Update all layouts to ensure data integrity
          const updatedLayouts = { ...state.layouts };
          for (const [nid, layout] of Object.entries(updatedLayouts)) {
            if (layout.racks?.some((r) => r.rackId === rackId)) {
              updatedLayouts[nid] = {
                ...layout,
                racks: updateRacksList(layout.racks),
              };
              // Note: multiple layouts shouldn't have the same rackId, but we update all just in case
            }
          }

          return {
            racks: updatedRacks,
            layouts: updatedLayouts,
          };
        });
      },

      moveDeviceInRack: (rackId: string, deviceId: string, newPosition: number) => {
        const { racks, isEditMode, pushUndoState } = get();
        const rack = racks.find((r) => r.rackId === rackId);
        if (!rack) return { success: false, reason: "Rack not found" };

        const targetDevice = rack.devices.find((d) => d.itemId === deviceId || d.deviceId === deviceId);
        if (!targetDevice) return { success: false, reason: "Device not found" };

        if (
          newPosition < 1 ||
          newPosition + targetDevice.size - 1 > rack.rackSize
        ) {
          return { success: false, reason: "랙 높이를 초과하여 배치할 수 없습니다." };
        }

        const collision = rack.devices.find((d) => {
          if (d.itemId === targetDevice.itemId) return false;
          const dStart = d.position;
          const dEnd = d.position + d.size - 1;
          const newStart = newPosition;
          const newEnd = newPosition + targetDevice.size - 1;
          return dStart <= newEnd && dEnd >= newStart;
        });

        if (collision) {
          return { success: false, reason: `"${collision.title}" 장비와 겹칩니다.` };
        }

        if (isEditMode) pushUndoState();

        set((state) => {
          const updateRacksList = (rList: Rack[]) =>
            rList.map((r) =>
              r.rackId === rackId
                ? {
                  ...r,
                  devices: r.devices.map(d =>
                    d.itemId === targetDevice.itemId ? { ...d, position: newPosition } : d
                  ),
                }
                : r,
            );

          const updatedRacks = updateRacksList(state.racks);
          const updatedLayouts = { ...state.layouts };
          for (const [nid, layout] of Object.entries(updatedLayouts)) {
            if (layout.racks?.some((r) => r.rackId === rackId)) {
              updatedLayouts[nid] = {
                ...layout,
                racks: updateRacksList(layout.racks),
              };
            }
          }
          return { racks: updatedRacks, layouts: updatedLayouts };
        });

        return { success: true };
      },

      updateRack: (id, updates) => {
        const { isEditMode, pushUndoState } = get();
        if (isEditMode) pushUndoState();
        set((state) => {
          const updatedRacks = state.racks.map((r) =>
            r.rackId === id ? { ...r, ...updates } : r,
          );
          const rack = state.racks.find((r) => r.rackId === id);
          const nid = rack?.mapId;

          return {
            racks: updatedRacks,
            layouts: nid
              ? {
                ...state.layouts,
                [nid]: { ...state.layouts[nid], racks: updatedRacks },
              }
              : state.layouts,
          };
        });
      },

      loadState: (newRacks, newModels, newRegisteredDevices, newNodes) => {
        // Migration: groupName → nodeId
        const migratedRacks = newRacks.map((r) => ({
          ...r,
          nodeId:
            r.mapId || migrateGroupNameToNodeId(String((r as Rack & { groupName?: string }).groupName || "과천")),
        }));
        const migratedRegDevices = (newRegisteredDevices ?? []).map((d) => ({
          ...d,
          nodeId:
            d.deviceGroupId ||
            migrateGroupNameToNodeId(String((d as RegisteredDevice & { groupName?: string }).groupName || "과천")),
        }));
        const finalNodes = newNodes && newNodes.length > 0 ? newNodes : [];
        const rootNode = finalNodes.find((n) => n.parentId === null);

        const collapsedNodeIds = new Set<string>();

        const firstRoomNode = finalNodes.find((n) => n.type === "room");
        const activeNodeId = firstRoomNode
          ? firstRoomNode.nodeId
          : rootNode
            ? rootNode.nodeId
            : finalNodes.length > 0
              ? finalNodes[0].nodeId
              : null;

        const activeSceneNodeId = firstRoomNode ? firstRoomNode.nodeId : activeNodeId;

        // Group racks and models by nodeId
        const layouts: Record<
          string,
          { racks: Rack[]; importedModels: ImportedModel[] }
        > = {};

        migratedRacks.forEach((r) => {
          if (!layouts[r.mapId])
            layouts[r.mapId] = { racks: [], importedModels: [] };
          layouts[r.mapId].racks.push(r);
        });

        (newModels ?? []).forEach((m) => {
          // If model doesn't have nodeId, we might need a default or use active one.
          // For now assume they have them or assign to active if missing
          const nid = (m as ImportedModel & { nodeId?: string }).nodeId || activeNodeId;
          if (nid) {
            if (!layouts[nid]) layouts[nid] = { racks: [], importedModels: [] };
            layouts[nid].importedModels.push(m);
          }
        });

        const activeLayout = activeNodeId
          ? layouts[activeNodeId] || { racks: [], importedModels: [] }
          : { racks: [], importedModels: [] };

        // Fetch Node-specific CyberSpace Environment or Default
        const nodeEnv = (activeNodeId && get().nodeEnvironments[activeNodeId]) || {};
        const cyberSpaceConfig = {
          ...(get().csIsLightMode ? LIGHT_THEME_CYBER_SPACE_CONFIG : DEFAULT_CYBER_SPACE_CONFIG),
          ...nodeEnv,
          csIsLightMode: get().csIsLightMode
        };

        set((state) => ({
          ...cyberSpaceConfig,
          layouts,
          racks: activeLayout.racks,
          importedModels: activeLayout.importedModels,
          registeredDevices: migratedRegDevices,
          nodes: finalNodes,
          activeNodeId,
          activeSceneNodeId,
          collapsedNodeIds,
          selectedRackId: null,
          focusedRackId: null,
          selectedModelId: null,
          // Set baselines to pre-load state so dirty detection works
          // Phase 3-A: 단일 structuredClone으로 통합
          ...(() => { const s = structuredClone({ r: state.racks, m: state.importedModels, n: state.nodes }); return { baselineRacks: s.r, baselineModels: s.m, baselineNodes: s.n }; })(),
          _importDirty: true,
          triggerFitToScene: state.triggerFitToScene + 1,
        }));
      },

      replaceNodeData: (nodeId, newRacks, newRegisteredDevices) => {
        set((state) => {
          if (nodeId === "ALL") {
            // Handle ALL - ideally we should group newRacks by nodeId
            const newLayouts: Record<
              string,
              { racks: Rack[]; importedModels: ImportedModel[] }
            > = {};
            newRacks.forEach((r) => {
              if (!newLayouts[r.mapId])
                newLayouts[r.mapId] = { racks: [], importedModels: [] };
              newLayouts[r.mapId].racks.push(r);
            });

            const activeLayout = state.activeNodeId
              ? newLayouts[state.activeNodeId] || { racks: [], importedModels: [] }
              : { racks: [], importedModels: [] };

            return {
              layouts: newLayouts,
              racks: activeLayout.racks,
              importedModels: activeLayout.importedModels,
              registeredDevices: newRegisteredDevices || [],
              selectedRackId: null,
              focusedRackId: null,
              selectedDeviceId: null,
            };
          }

          const otherRegDevices = state.registeredDevices.filter(
            (d) => d.deviceGroupId !== nodeId,
          );

          const updatedLayouts = {
            ...state.layouts,
            [nodeId]: {
              racks: newRacks,
              importedModels: state.layouts[nodeId]?.importedModels || [],
            },
          };

          const isCurrentNode = state.activeNodeId === nodeId;

          return {
            layouts: updatedLayouts,
            racks: isCurrentNode ? newRacks : state.racks,
            registeredDevices: newRegisteredDevices
              ? [...otherRegDevices, ...newRegisteredDevices]
              : state.registeredDevices,
            selectedRackId: null,
            focusedRackId: null,
            selectedDeviceId: null,
          };
        });
      },

      updateDevicePortStates: (deviceId, newPortStates) =>
        set((state) => {
          let updated = false;
          const newRacks = state.racks.map((rack) => {
            const hasDevice = rack.devices.some((d) => d.itemId === deviceId);
            if (!hasDevice) return rack;

            updated = true;
            return {
              ...rack,
              devices: rack.devices.map((d) =>
                d.itemId === deviceId ? { ...d, portStates: newPortStates } : d,
              ),
            };
          });

          // Update layouts as well to ensure data consistency across nodes
          const newLayouts = { ...state.layouts };
          let anyLayoutUpdated = false;
          Object.entries(newLayouts).forEach(([nid, layout]) => {
            if (!layout.racks) return;
            let layoutUpdated = false;
            const layoutRacks = layout.racks.map((rack) => {
              const hasDevice = rack.devices.some((d) => d.itemId === deviceId);
              if (!hasDevice) return rack;
              layoutUpdated = true;
              updated = true;
              return {
                ...rack,
                devices: rack.devices.map((d) =>
                  d.itemId === deviceId ? { ...d, portStates: newPortStates } : d,
                ),
              };
            });
            if (layoutUpdated) {
              newLayouts[nid] = { ...layout, racks: layoutRacks };
              anyLayoutUpdated = true;
            }
          });

          if (!updated) return state;

          // Update baselineRacks to prevent these system enrichment updates 
          // from flagging the workspace as 'dirty' (unsaved changes).
          const newBaselineRacks = state.baselineRacks ? state.baselineRacks.map((rack) => {
            const hasDevice = rack.devices.some((d) => d.itemId === deviceId);
            if (!hasDevice) return rack;
            return {
              ...rack,
              devices: rack.devices.map((d) =>
                d.itemId === deviceId ? { ...d, portStates: newPortStates } : d,
              ),
            };
          }) : state.baselineRacks;

          return {
            racks: newRacks,
            layouts: anyLayoutUpdated ? newLayouts : state.layouts,
            baselineRacks: newBaselineRacks
          };
        }),

      replaceMultipleNodesData: (data) => {
        set((state) => {
          let updatedRegDevices = [...state.registeredDevices];
          const updatedLayouts = { ...state.layouts };

          // Capture pre-import state for baseline (so getIsDirty detects changes)
          // Phase 3-A: 단일 structuredClone으로 통합
          const preImport = structuredClone({ racks: state.racks, importedModels: state.importedModels, nodes: state.nodes });
          const preImportRacks = preImport.racks;
          const preImportModels = preImport.importedModels;
          const preImportNodes = preImport.nodes;

          Object.entries(data).forEach(([nodeId, nodeData]) => {
            updatedRegDevices = updatedRegDevices.filter(
              (d) => d.deviceGroupId !== nodeId,
            );
            updatedRegDevices.push(...nodeData.registeredDevices);

            updatedLayouts[nodeId] = {
              racks: nodeData.racks,
              importedModels: updatedLayouts[nodeId]?.importedModels || [],
            };
          });

          const activeLayout = state.activeNodeId
            ? updatedLayouts[state.activeNodeId] || {
              racks: [],
              importedModels: [],
            }
            : { racks: [], importedModels: [] };

          return {
            layouts: updatedLayouts,
            racks: activeLayout.racks,
            importedModels: activeLayout.importedModels,
            registeredDevices: updatedRegDevices,
            selectedRackId: null,
            focusedRackId: null,
            selectedDeviceId: null,
            // Set baseline to pre-import state so changes are detectable
            baselineRacks: preImportRacks,
            baselineModels: preImportModels,
            baselineNodes: preImportNodes,
            _importDirty: true,
          };
        });
      },

      // Hierarchy Node Management
      addNode: (nodeData) => {
        const { isEditMode, pushUndoState, nodes } = get();
        if (isEditMode) pushUndoState();
        const newId = nodeData.nodeId || `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Auto-calculate order if not provided
        let finalOrder = nodeData.order;
        if (finalOrder === undefined) {
          const siblings = nodes.filter((n) => n.parentId === nodeData.parentId);
          finalOrder =
            siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
        }

        const newNode: HierarchyNode = {
          ...nodeData,
          nodeId: newId,
          order: finalOrder,
        };

        set((state) => ({ nodes: [...state.nodes, newNode] }));

        return newId;
      },

      renameNode: (nodeId, name) => {
        const { isEditMode, pushUndoState } = get();
        if (isEditMode) pushUndoState();
        set((state) => ({
          nodes: state.nodes.map((n) => (n.nodeId === nodeId ? { ...n, name } : n)),
        }));
      },

      deleteNode: (nodeId) => {
        const { isEditMode, pushUndoState } = get();
        if (isEditMode) pushUndoState();
        set((state) => {
          // 1. Delete node and descendant hierarchy structurally
          const toDelete = new Set<string>();
          const queue = [nodeId];
          while (queue.length > 0) {
            const curr = queue.shift()!;
            toDelete.add(curr);
            state.nodes.forEach((n) => {
              if (n.parentId === curr) queue.push(n.nodeId);
            });
          }

          // 2. But for data isolation, only clean data bound *exactly* to nodes being structurally deleted.
          const updatedLayouts = { ...state.layouts };
          toDelete.forEach((id) => delete updatedLayouts[id]);

          return {
            nodes: state.nodes.filter((n) => !toDelete.has(n.nodeId)),
            racks: state.racks.filter((r) => !toDelete.has(r.mapId)),
            registeredDevices: state.registeredDevices.filter(
              (d) => !toDelete.has(d.deviceGroupId || ""),
            ),
            layouts: updatedLayouts,
            activeNodeId:
              state.activeNodeId && toDelete.has(state.activeNodeId)
                ? state.nodes.find((n) => n.parentId === null)?.nodeId || null
                : state.activeNodeId,
          };
        });
      },

      setCollapsedNodeIds: (ids) => set({ collapsedNodeIds: ids }),
      toggleNodeExpansion: (nodeId, expand) => {
        set((state) => {
          const next = new Set(state.collapsedNodeIds);
          const shouldExpand = expand !== undefined ? expand : next.has(nodeId);

          if (shouldExpand) {
            next.delete(nodeId);
          } else {
            next.add(nodeId);
          }
          return { collapsedNodeIds: next };
        });
      },
      expandNodePath: (nodeId) => {
        if (!nodeId) return;
        set((state) => {
          const next = new Set(state.collapsedNodeIds);
          const { nodes } = state;
          let curr = nodes.find((n) => n.nodeId === nodeId);
          next.delete(nodeId);
          while (curr && curr.parentId) {
            next.delete(curr.parentId);
            curr = nodes.find((n) => n.nodeId === curr?.parentId);
          }
          return { collapsedNodeIds: next };
        });
      },
      setHierarchyCollapsed: (collapsed) =>
        set({ isHierarchyCollapsed: collapsed }),

      reorderNode: (nodeId, targetNodeId, position) => {
        const { isEditMode, pushUndoState } = get();
        if (nodeId === targetNodeId) return;

        if (isEditMode) pushUndoState();

        set((state) => {
          const sourceNode = state.nodes.find((n) => n.nodeId === nodeId);
          const targetNode = state.nodes.find((n) => n.nodeId === targetNodeId);

          if (!sourceNode || !targetNode) return state;

          // Circularity check: node cannot be parent of its own ancestor
          const getDescendants = (id: string): string[] => {
            const children = state.nodes.filter((n) => n.parentId === id);
            return [id, ...children.flatMap((c) => getDescendants(c.nodeId))];
          };
          if (getDescendants(nodeId).includes(targetNodeId)) {
            return state;
          }

          let newParentId: string | null = null;
          let newOrder = 0;

          if (position === "inside") {
            newParentId = targetNodeId;
            const siblings = state.nodes.filter((n) => n.parentId === newParentId);
            newOrder =
              siblings.length > 0
                ? Math.max(...siblings.map((s) => s.order)) + 1
                : 0;
          } else {
            newParentId = targetNode.parentId;
            newOrder =
              position === "before" ? targetNode.order : targetNode.order + 1;
          }

          // Re-assign orders for all siblings
          const updatedNodes = state.nodes.map((n) => {
            if (n.nodeId === nodeId) {
              return { ...n, parentId: newParentId, order: newOrder };
            }

            // If moving within same parent or into new parent
            if (n.parentId === newParentId) {
              if (n.nodeId !== nodeId) {
                if (n.order >= newOrder) {
                  return { ...n, order: n.order + 1 };
                }
              }
            }
            return n;
          });

          // Optional: normalization of orders to 0, 1, 2...
          const normalizeOrders = (nodes: HierarchyNode[], pId: string | null) => {
            const parentSiblings = nodes
              .filter((n) => n.parentId === pId)
              .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

            parentSiblings.forEach((s, idx) => {
              const match = nodes.find((n) => n.nodeId === s.nodeId);
              if (match) match.order = idx;
            });
          };

          // Normalize for both old parent and new parent
          const finalNodes = [...updatedNodes];
          normalizeOrders(finalNodes, sourceNode.parentId);
          normalizeOrders(finalNodes, newParentId);

          return { nodes: finalNodes };
        });
      },

      upsertNodes: (newNodes, overwrite, dryRun = false) => {
        const mapping: Record<string, string> = {};
        const process = (stateNodes: HierarchyNode[]) => {
          const updatedNodes = [...stateNodes];

          newNodes.forEach((n) => {
            if (n.nodeId === NONE_NODE_ID) return;
            mapping[n.nodeId] = n.nodeId;
            const matchIdx = updatedNodes.findIndex((ex) => ex.nodeId === n.nodeId);
            if (matchIdx >= 0) {
              if (overwrite) {
                updatedNodes[matchIdx] = { ...updatedNodes[matchIdx], ...n };
              }
            } else {
              const duplicateIdx = updatedNodes.findIndex(
                (ex) => ex.parentId === n.parentId && ex.name === n.name,
              );
              if (duplicateIdx >= 0) {
                mapping[n.nodeId] = updatedNodes[duplicateIdx].nodeId;
                if (overwrite) {
                  updatedNodes[duplicateIdx] = {
                    ...updatedNodes[duplicateIdx],
                    ...n,
                    nodeId: updatedNodes[duplicateIdx].nodeId,
                  };
                }
              } else {
                updatedNodes.push(n);
              }
            }
          });
          return updatedNodes;
        };

        const updatedNodes = process(get().nodes);
        if (!dryRun) {
          set({ nodes: updatedNodes });
        }
        return { mapping, updatedNodes };
      },

      // Imported Model Actions
      addImportedModel: (modelData) => {
        const { _cameraRef, isEditMode, pushUndoState, activeNodeId, nodes } = get();

        const activeNode = nodes.find(n => n.nodeId === activeNodeId);
        if (!activeNodeId || activeNode?.type !== "room") {
          get().showToast("전산실을 선택하거나 생성해주세요.", "error");
          return null;
        }

        if (isEditMode) pushUndoState();
        let spawnPos: [number, number, number] = modelData.position;

        if (
          spawnPos[0] === 0 &&
          spawnPos[1] === 0 &&
          spawnPos[2] === 0 &&
          _cameraRef
        ) {
          const raycaster = new Raycaster();
          const center = new Vector2(0, 0);
          raycaster.setFromCamera(center, _cameraRef);
          const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
          const hitPoint = new Vector3();

          if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
            const gridX =
              (Math.round((hitPoint.x / GRID_SPACING) * 4) / 4) * GRID_SPACING;
            const gridZ =
              (Math.round((hitPoint.z / GRID_SPACING) * 4) / 4) * GRID_SPACING;
            spawnPos = [gridX, 0, gridZ];
          }
        }

        const newId = crypto.randomUUID();
        const model: ImportedModel = {
          ...modelData,
          id: newId,
          position: spawnPos,
          isMoveEnabled: modelData.isMoveEnabled ?? false,
        };

        set((state) => {
          const updatedModels: ImportedModel[] = [...state.importedModels, model];
          return {
            importedModels: updatedModels,
            layouts: activeNodeId
              ? {
                ...state.layouts,
                [activeNodeId]: {
                  ...(state.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  importedModels: updatedModels,
                },
              }
              : state.layouts,
          };
        });
        return newId;
      },

      selectModel: (id) =>
        set({
          selectedModelId: id,
          selectedRackId: null,
          focusedRackId: null,
          selectedDeviceId: null,
          hoveredDevice: null,
        }),

      deleteModel: (id) => {
        const { isEditMode, pushUndoState, activeNodeId } = get();
        if (isEditMode) pushUndoState();
        set((state) => {
          const updatedModels: ImportedModel[] = state.importedModels.filter(
            (m) => m.id !== id,
          );
          return {
            importedModels: updatedModels,
            selectedModelId:
              state.selectedModelId === id ? null : state.selectedModelId,
            layouts: activeNodeId
              ? {
                ...state.layouts,
                [activeNodeId]: {
                  ...(state.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  importedModels: updatedModels,
                },
              }
              : state.layouts,
          };
        });
      },

      updateModel: (id, updates) => {
        const { isEditMode, pushUndoState, activeNodeId } = get();
        if (isEditMode) pushUndoState();
        set((state) => {
          const updatedModels: ImportedModel[] = state.importedModels.map((m) =>
            m.id === id ? { ...m, ...updates } : m,
          );
          return {
            importedModels: updatedModels,
            layouts: activeNodeId
              ? {
                ...state.layouts,
                [activeNodeId]: {
                  ...(state.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  importedModels: updatedModels,
                },
              }
              : state.layouts,
          };
        });
      },

      setModelDragging: (modelId, pos = null, offset = null) =>
        set({
          draggingModelId: modelId,
          modelDragPosition: pos,
          modelDragOffset: offset,
        }),

      updateModelDragPosition: (pos) => set({ modelDragPosition: pos }),

      endModelDrag: (id, position) => {
        const { isEditMode, pushUndoState, activeNodeId, importedModels } = get();
        const model = importedModels.find((m) => m.id === id);
        if (!model) return;

        const finalPos: [number, number, number] = [
          position[0],
          model.position[1],
          position[1],
        ];
        const hasMoved = !layoutsEqual(model.position, finalPos);

        if (hasMoved && isEditMode) {
          pushUndoState();
        }

        set((state) => {
          const updatedModels: ImportedModel[] = hasMoved
            ? state.importedModels.map((m) =>
              m.id === id ? { ...m, position: finalPos } : m,
            )
            : state.importedModels;

          return {
            importedModels: updatedModels,
            draggingModelId: null,
            modelDragPosition: null,
            modelDragOffset: null,
            layouts: activeNodeId
              ? {
                ...state.layouts,
                [activeNodeId]: {
                  ...(state.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  importedModels: updatedModels,
                },
              }
              : state.layouts,
          };
        });
      },

      toggleModelMove: (id) => {
        const state = get();
        const model = state.importedModels.find((m) => m.id === id);
        if (!model) return;

        const newEnabled = !model.isMoveEnabled;

        if (!newEnabled && state.draggingModelId === id) {
          set({
            draggingModelId: null,
            modelDragPosition: null,
            modelDragOffset: null,
          });
          document.body.style.cursor = "auto";
        }

        set((s) => {
          const updatedModels: ImportedModel[] = s.importedModels.map((m) =>
            m.id === id ? { ...m, isMoveEnabled: newEnabled } : m,
          );
          const activeNodeId = s.activeNodeId;
          return {
            importedModels: updatedModels,
            layouts: activeNodeId
              ? {
                ...s.layouts,
                [activeNodeId]: {
                  ...(s.layouts[activeNodeId] || {
                    racks: [],
                    importedModels: [],
                  }),
                  importedModels: updatedModels,
                },
              }
              : s.layouts,
          };
        });
      },

      reparentNode: (nodeId, newParentId) => {
        const { nodes, isEditMode, pushUndoState } = get();

        // Safety Checks
        if (nodeId === newParentId) return;

        // Check if newParentId is a descendant of nodeId (to prevent circularity)
        // getSubtreeNodeIds already includes nodeId
        const subtreeIds = new Set<string>();
        const stack = [nodeId];
        while (stack.length > 0) {
          const curr = stack.pop()!;
          subtreeIds.add(curr);
          nodes.forEach((n) => {
            if (n.parentId === curr) stack.push(n.nodeId);
          });
        }

        if (newParentId && subtreeIds.has(newParentId)) {
          get().showToast("Cannot move a node under its own descendant.", "error");
          return;
        }

        if (isEditMode) pushUndoState();

        set((state) => {
          // Find new order: max(order of siblings) + 1
          const siblings = state.nodes.filter((n) => n.parentId === newParentId);
          const newOrder =
            siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;

          const updatedNodes = state.nodes.map((n) => {
            if (n.nodeId === nodeId) {
              return { ...n, parentId: newParentId, order: newOrder };
            }
            return n;
          });

          return { nodes: updatedNodes };
        });
      },
    }),
    {
      name: "server-room-storage",
      partialize: (state) => {
        const {
          _cameraRef,
          _controlsRef,
          pendingImportFile,
          toast,
          blinkTimeoutId,
          isDragging,
          draggingRackId,
          dragPosition,
          dragOffset,
          draggingModelId,
          modelDragPosition,
          modelDragOffset,
          importExportModalRackId,
          deviceDeleteConfirm,
          deviceRegistrationModalOpen,
          modelRegistrationModalOpen,
          undoStack,
          redoStack,
          showUnsavedDialog,
          pendingAction,
          triggerFitToScene,
          collapsedNodeIds,
          selectedRackId,
          selectedModelId,
          selectedDeviceId,
          highlightedDeviceId,
          focusedRackId,
          activeNodeId,
          hoveredDevice,
          hoveredRackId,
          obstructingRackIds,
          preFocusCameraState,
          isEditMode,
          isCanvasReady,
          _importDirty,
          customModels,
          isSyncingPorts,
          ...rest
        } = state;
        return rest;
      },
      merge: (persistedState: any, currentState: AppState) => {
        // Keep the imported initialCustomModelsData as the base source of truth,
        // and override only if persistedState has non-empty custom models and they differ.
        // But since we persist to project files now, we actually don't need to restore
        // customModels from localStorage, except for backwards compatibility.
        // To be safe, we just use the persisted state directly without deleting row properties.
        const cleanedCustomModels = persistedState.customModels
          ? structuredClone(persistedState.customModels)
          : currentState.customModels;

        // Fix race condition where IndexedDB loads after ThemeContext and overwrites the theme.
        // We force the theme settings to match whatever currentState.csIsLightMode holds, 
        // while allowing other persisted size configurations to be restored.
        const themeConfig = currentState.csIsLightMode
          ? LIGHT_THEME_CYBER_SPACE_CONFIG
          : DEFAULT_CYBER_SPACE_CONFIG;

        const sizeConfig = {
          cyberSpaceEnabled: persistedState.cyberSpaceEnabled ?? currentState.cyberSpaceEnabled,
          csCustomSpaceSize: persistedState.csCustomSpaceSize ?? currentState.csCustomSpaceSize,
          csRoomWidthCm: persistedState.csRoomWidthCm ?? currentState.csRoomWidthCm,
          csRoomLengthCm: persistedState.csRoomLengthCm ?? currentState.csRoomLengthCm,
          csOffsetXCm: persistedState.csOffsetXCm ?? currentState.csOffsetXCm,
          csOffsetZCm: persistedState.csOffsetZCm ?? currentState.csOffsetZCm,
        };

        return {
          ...currentState,
          ...persistedState,
          ...themeConfig,
          ...sizeConfig,
          isEditMode: false,
          isCanvasReady: false,
          isSyncingPorts: false,
          pendingImportFile: null,
          customModels: cleanedCustomModels,
          racks: persistedState.baselineRacks ? structuredClone(persistedState.baselineRacks) : (persistedState.racks ? structuredClone(persistedState.racks) : []),
          importedModels: persistedState.baselineModels ? structuredClone(persistedState.baselineModels) : (persistedState.importedModels ? structuredClone(persistedState.importedModels) : []),
          nodes: persistedState.baselineNodes ? structuredClone(persistedState.baselineNodes) : (persistedState.nodes ? structuredClone(persistedState.nodes) : []),
          registeredDevices: persistedState.baselineRegisteredDevices ? structuredClone(persistedState.baselineRegisteredDevices) : (persistedState.registeredDevices ? structuredClone(persistedState.registeredDevices) : []),
          nodeEnvironments: persistedState.baselineNodeEnvironments ? structuredClone(persistedState.baselineNodeEnvironments) : (persistedState.nodeEnvironments ? structuredClone(persistedState.nodeEnvironments) : {}),
          layouts: persistedState.baselineLayouts ? structuredClone(persistedState.baselineLayouts) : (persistedState.layouts ? structuredClone(persistedState.layouts) : {}),
          _importDirty: false,
        };
      },
      storage: createJSONStorage(() => idbStorage),
    }
  )
);
