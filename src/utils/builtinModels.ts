import type { BuiltinModelType, WallParams, PartitionParams, LightParams } from "../types";

export interface BuiltinModelDef {
  type: BuiltinModelType;
  label: string;
  icon: string;
  /** Public URL path to GLB, empty string for procedural models (Wall) */
  assetUrl: string;
  fileName: string;
  /** UI(팔레트) 노출 여부 (기존 호환성을 위해 유지하되 버튼은 숨길 때 사용) */
  hidden?: boolean;
}

/** Default wall parameters */
export const DEFAULT_WALL_PARAMS: WallParams = {
  height: 3,
  length: 5,
  thickness: 0.15,
  color: "#8a8a8a",
};

/** Default light parameters */
export const DEFAULT_LIGHT_PARAMS: LightParams = {
  intensity: 1.5,
  color: "#ffffff",
  castShadow: true,
  shadowMapSize: 1024,
};

/** Default partition parameters */
export const DEFAULT_PARTITION_PARAMS: PartitionParams = {
  height: 2.2,
  length: 2.5,
  thickness: 0.08,
  color: "#a0aec0", // blue-ish gray
  visibilityMode: "transparent",
};

/** List of all built-in models available in the palette */
export const BUILTIN_MODELS: BuiltinModelDef[] = [
  {
    type: "Wall",
    label: "Wall",
    icon: "mdi:wall",
    assetUrl: "", // procedural — no GLB
    fileName: "__builtin_wall",
  },
  {
    type: "Chair",
    label: "Chair",
    icon: "mdi:chair-rolling",
    assetUrl: "/assets/3D/Chair.glb",
    fileName: "__builtin_chair.glb",
    hidden: true,
  },
  {
    type: "Desk",
    label: "Desk",
    icon: "mdi:desk",
    assetUrl: "/assets/3D/Desk.glb",
    fileName: "__builtin_desk.glb",
    hidden: true,
  },
  {
    type: "Desk2",
    label: "Desk 2",
    icon: "mdi:desk",
    assetUrl: "/assets/3D/Desk2.glb",
    fileName: "__builtin_desk2.glb",
    hidden: true,
  },
  {
    type: "Partition",
    label: "Partition",
    icon: "mdi:slash-forward-box",
    assetUrl: "", // procedural
    fileName: "__builtin_partition",
    hidden: true,
  },
  {
    type: "Clock",
    label: "Clock",
    icon: "mdi:clock-digital",
    assetUrl: "", // procedural component
    fileName: "__builtin_clock",
  },
  {
    type: "Light",
    label: "Light",
    icon: "mdi:lightbulb",
    assetUrl: "", // procedural — emits directional light
    fileName: "__builtin_light",
    hidden: true,
  },
  {
    type: "ACStand",
    label: "에어컨",
    icon: "mdi:air-conditioner",
    assetUrl: "/models/AC_stand.glb",
    fileName: "__builtin_ac_stand.glb",
  },
  {
    type: "Printer",
    label: "프린터",
    icon: "mdi:printer",
    assetUrl: "/models/printer.glb",
    fileName: "__builtin_printer.glb",
  },
  {
    type: "DeskOn",
    label: "데스크 ON",
    icon: "mdi:desk",
    assetUrl: "/models/desk_on.glb",
    fileName: "__builtin_desk_on.glb",
  },
  {
    type: "DeskOff",
    label: "데스크 OFF",
    icon: "mdi:desk",
    assetUrl: "/models/desk_off.glb",
    fileName: "__builtin_desk_off.glb",
  },
  {
    type: "ChairOffice",
    label: "사무용 의자",
    icon: "mdi:chair-rolling",
    assetUrl: "/models/chair_office.glb",
    fileName: "__builtin_chair_office.glb",
  },
  {
    type: "PartitionModel",
    label: "파티션 (Model)",
    icon: "mdi:slash-forward-box",
    assetUrl: "/models/partition.glb",
    fileName: "__builtin_partition_model.glb",
  },
  {
    type: "TableSmall",
    label: "테이블",
    icon: "mdi:table-furniture",
    assetUrl: "/models/table_small.glb",
    fileName: "__builtin_table_small.glb",
  },
  {
    type: "DoorAuto",
    label: "자동문",
    icon: "mdi:door-sliding-open",
    assetUrl: "/models/door_auto.glb",
    fileName: "__builtin_door_auto.glb",
  },
];
