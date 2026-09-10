// 에러 레벨
export type ErrorLevel = "critical" | "major" | "minor" | "warning";

// 노드 타입 (확장 가능)
export type NodeType = "root" | "group" | "site" | "room" | "zone";

// 계층 노드 (트리 구조)
export interface HierarchyNode {
  nodeId: string; // 고유 ID
  parentId: string | null; // null = root
  name: string; // 표시 이름
  type: NodeType; // 노드 유형
  order: number; // 형제 정렬 순서
  metadata?: Record<string, unknown>; // 확장 데이터 (선택)
}

// 하위 호환용 GroupName (migration 전용)
export type GroupName = "과천" | "대전";

// 제조사 이름
export type VendorName =
  | "AXGATE"
  | "Cisco"
  | "Ciena"
  | "Coweaver"
  | "Dasan"
  | "Dell"
  | "Edgecore"
  | "Juniper"
  | "Nokia"
  | "Rebellions"
  | "Supermicro"
  | "Ubiquoss"
  | "Woorinet"
  // Legacy mappings for existing templates/data
  | "코위버PTN"
  | "CISCO"
  | "Huawei"
  | "유비쿼스"
  | string;

// 장비 타입
export type DeviceType = "Switch" | "Router" | "Server";

/** 
 * [VITE_CACHE_BREAKER_9999] 
 * 이 주석은 Vite 개발 서버의 모듈 캐시를 완전히 파괴하기 위해 추가되었습니다.
 * 장비 (t_rack_device - 랙에 배치된 장비)
 */
export interface Device {
  itemId: string;
  rackId?: string;
  deviceId?: string;
  title: string;
  position: number;
  imageName?: string;
  size: number;
  del_yn?: string;
  modiDate?: string;
  regDate?: string;
  type: DeviceType;
  modelName?: string;
  vendor?: VendorName;
  IPAddr?: string;
  macAddr?: string;
  portStates: PortState[];
  insertedCards?: import("./equipment").InsertedCard[];
  insertedModules?: import("./equipment").InsertedModule[];

  defaultViewSide?: import("./equipment").EquipmentViewSide;
  devicePngRaw?: string;
}

/** [VITE_CACHE_BREAKER_PORT] */
export interface PortState {
  portId: string;
  status: "normal" | "error";
  errorLevel?: ErrorLevel;
  errorMessage?: string;
  portName?: string;
  portNumber?: string;
  /** 모듈러 카드 소속 인스턴스 ID (카드 기반 장비 전용) */
  cardInstanceId?: string;
}

// 등록 장비 (t_device 마스터 장비 인벤토리)
export interface RegisteredDevice {
  // 필수 필드 (Primary, 사용자 정의 필수)
  deviceId: string;
  IPAddr: string;
  title: string;
  macAddr: string;

  // 이외의 t_device 옵셔널 속성들
  deviceGroupId?: string; // (ex: nodeId)
  modelId?: number;
  standardCheck?: number;
  deviceCheck?: number;
  standardDeviceId?: number;
  modelName?: string;
  hostName?: string;
  tmid?: string;
  externalId?: number;
  IsrAddr?: string;
  snmpVer?: string;
  snmpPort?: number;
  readCommunity?: string;
  writeCommunity?: string;
  snmpId?: string;
  snmpPwd?: string;
  snmpAuthpass?: string;
  snmpPrivpass?: string;
  snmpAuthprotocol?: string;
  snmpPrivprotocol?: string;
  snmpV3level?: number;
  connectType?: string;
  connectPort?: string;
  connectId?: string;
  connectPwd?: string;
  targetIp?: string;
  targetPort?: string;
  reservParam?: string;
  userSubnet?: string;
  interfaceSubnet?: string;
  proxyIp?: string;
  proxyPort?: string;
  proxyId?: string;
  proxyPwd?: string;
  privilegeUser?: string;
  privilegeMethod?: string;
  privilegePwd?: string;
  memo?: string;
  colErrStatus?: number;
  colInvStatus?: string;
  deviceState?: number;
  isKnown?: number;
  errorPredict?: number;
  regUser?: string;
  regDate?: string;
  colDate?: string;
  modiUser?: string;
  modiDate?: string;
  addItem1?: string;
  addItem2?: string;
  addItem3?: string;
  interfaceMacList?: string;
  osVersion?: string;
  isDevMonit?: number;
  isDevSetting?: number;
  isDeviceOid?: number;
  snmpControl?: number;
  cpumemControl?: number;
  interfaceControl?: number;
  pingControl?: number;
  connectControl?: number;
  sdnControl?: number;
  syslogControl?: number;
  syslogPerfControl?: number;
  diskControl?: number;
  processControl?: number;
  tmpHmdControl?: number;
  cctvControl?: number;
  ptnTunnelControl?: number;
  ptnServiceControl?: number;
  ipmplsLspControl?: number;
  ipmplsServiceControl?: number;
  roadmServiceControl?: number;
  ipmplsEquipControl?: number;
  roadmEquipControl?: number;
  ptnEquipControl?: number;
  transportLinkControl?: number;
  upsControl?: number;
  tmpHmdChamberControl?: number;
  fireDetectionControl?: number;
  del_yn?: string;
  system_code_id?: string;
  delDate?: string;
  delUser?: string;
  encoding?: string;
  deviceOidSetting?: number;
  lspControl?: number;
  serviceControl?: number;
  transportPathControl?: number;
  vlanarpControl?: number;

  // UI/3D 확장을 위한 기존 속성 유지
  type?: DeviceType;
  size?: number; // (ex: uSize)
  vendor?: VendorName;

  // 장비 조립(SVG 구성) 추가
  insertedCards?: import("./equipment").InsertedCard[];
  insertedModules?: import("./equipment").InsertedModule[];
  generatedPorts?: import("./equipment").GeneratedPort[];
  defaultViewSide?: import("./equipment").EquipmentViewSide;
  devicePngRaw?: string;
}

// 렉 방향
export type Orientation = 0 | 90 | 180 | 270;

// 렉 (t_rack 및 3D 속성 통합)
export interface Rack {
  rackId: string;
  mapId: string; // (ex: nodeId)
  rackTitle?: string;
  rackType?: string;
  rackSize: 24 | 32 | 48; // (ex: uHeight)
  memo?: string;
  del_yn?: string;
  modiDate?: string;
  regDate?: string;

  // 3D 확장 속성 (새로 편입)
  width: number;
  position: [number, number];
  orientation?: Orientation;

  devices: Device[];
}

export interface DraggedItem {
  type: "rk"; // rack
}

// Built-in 모델 종류
export type BuiltinModelType =
  | "Wall"
  | "Chair"
  | "Desk"
  | "Desk2"
  | "Partition"
  | "Clock"
  | "Light"
  | "ACStand"
  | "Printer"
  | "DeskOn"
  | "DeskOff"
  | "ChairOffice"
  | "PartitionModel"
  | "TableLarge"
  | "TableSmall"
  | "DoorAuto";

// 가시성 모드 (투명 유리 vs 불투명)
export type VisibilityMode = "transparent" | "opaque";

// Partition 파라메트릭 파라미터
export interface PartitionParams {
  height: number;
  length: number;
  thickness: number;
  color: string;
  visibilityMode: VisibilityMode;
}

// Wall 파라메트릭 파라미터
export interface WallParams {
  height: number; // Y축 높이 (미터)
  length: number; // X축 길이 (미터)
  thickness: number; // Z축 두께 (미터)
  color: string; // hex color
}

// Light 파라메트릭 파라미터
export interface LightParams {
  intensity: number; // 빛 세기
  color: string; // hex color
  castShadow: boolean; // 그림자 여부
  shadowMapSize: number; // 그림자 해상도 (256 ~ 4096)
}

// 임포트된 3D 모델
export interface ImportedModel {
  id: string;
  name: string;
  fileName: string;
  /** Base64 data URL of the GLB file, or public URL path for built-in models */
  dataUrl: string;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler angles in radians
  scale: [number, number, number];
  /** Per-model movement toggle: true = movable, false = locked (default: false) */
  isMoveEnabled?: boolean;
  /** If set, this model is a built-in default model */
  builtinType?: BuiltinModelType;
  /** Wall-specific parametric dimensions (only when builtinType === "Wall") */
  wallParams?: WallParams;
  /** Partition-specific parametric dimensions (only when builtinType === "Partition") */
  partitionParams?: PartitionParams;
  /** Light-specific parameters (only when builtinType === "Light") */
  lightParams?: LightParams;
}
