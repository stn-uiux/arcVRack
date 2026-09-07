import { Icon } from "@iconify/react";
import React, { useRef, useState, useCallback, useEffect } from "react";
import { useStore } from "../../store/useStore";
import type { ImportedModel, WallParams, PartitionParams, LightParams } from "../../types";
import {
  BUILTIN_MODELS,
  DEFAULT_WALL_PARAMS,
  DEFAULT_PARTITION_PARAMS,
  DEFAULT_LIGHT_PARAMS,
} from "../../utils/builtinModels";
import type { BuiltinModelDef } from "../../utils/builtinModels";
import {
  exportModels,
  readModelExportFile,
  getImportPreview,
  deserializeModels,
  type ModelExportPackage,
  type ImportPreview,
} from "../../utils/modelStorage";
import { HierarchyTree } from "../layout/HierarchyTree";
import { calculateDynamicRoomSize } from "../../utils/rackGeometry";
/** Read a File as a base64 data URL */
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const isValidExtension = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith(".glb") || lower.endsWith(".gltf");
};

export const ModelImporter = () => {
  const isEditMode = useStore((s) => s.isEditMode);
  const addImportedModel = useStore((s) => s.addImportedModel);
  const importedModels = useStore((s) => s.importedModels);
  const selectedModelId = useStore((s) => s.selectedModelId);
  const selectModel = useStore((s) => s.selectModel);
  const deleteModel = useStore((s) => s.deleteModel);
  const updateModel = useStore((s) => s.updateModel);
  const toggleModelMove = useStore((s) => s.toggleModelMove);

  const csCustomSpaceSize = useStore((s) => s.csCustomSpaceSize);
  const cyberSpaceEnabled = useStore((s) => s.cyberSpaceEnabled);
  const csRoomWidthCm = useStore((s) => s.csRoomWidthCm);
  const csRoomLengthCm = useStore((s) => s.csRoomLengthCm);
  const csOffsetXCm = useStore((s) => s.csOffsetXCm);
  const csOffsetZCm = useStore((s) => s.csOffsetZCm);
  const racks = useStore((s) => s.racks);
  const activeNodeId = useStore((s) => s.activeNodeId);
  const nodes = useStore((s) => s.nodes);
  const { width: dynamicWidth, length: dynamicLength } = calculateDynamicRoomSize(
    racks,
    importedModels,
    activeNodeId,
    csRoomWidthCm,
    csRoomLengthCm,
    csCustomSpaceSize
  );

  const displayWidthCm = csCustomSpaceSize ? csRoomWidthCm : Math.round(dynamicWidth * 100);
  const displayLengthCm = csCustomSpaceSize ? csRoomLengthCm : Math.round(dynamicLength * 100);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);

  // Model export/import state
  const modelImportRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const [importPkg, setImportPkg] = useState<ModelExportPackage | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleExportModels = useCallback(async () => {
    if (importedModels.length === 0) {
      setError("No models to export.");
      setTimeout(() => setError(null), 3000);
      return;
    }
    try {
      await exportModels(importedModels);
      setSuccessMsg(`Exported ${importedModels.length} model(s)`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
      setTimeout(() => setError(null), 4000);
    }
  }, [importedModels]);

  const handleModelImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const state = useStore.getState();
      const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
      if (!state.activeNodeId || activeNode?.type !== "room") {
        e.preventDefault();
        state.showToast("전산실을 먼저 선택해주세요.", "error");
        return;
      }
      const file = e.target.files?.[0];
      if (modelImportRef.current) modelImportRef.current.value = "";
      if (!file) return;
      try {
        setImportError(null);
        const pkg = await readModelExportFile(file);
        const preview = getImportPreview(pkg);
        setImportPkg(pkg);
        setImportPreview(preview);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const handleConfirmImport = useCallback(() => {
    if (!importPkg) return;
    setIsImporting(true);
    try {
      const models = deserializeModels(importPkg);
      for (const m of models) {
        addImportedModel(m);
      }
      setSuccessMsg(`Imported ${models.length} model(s)`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setIsImporting(false);
      setImportPkg(null);
      setImportPreview(null);
    }
  }, [importPkg, addImportedModel]);

  const handleCancelImport = useCallback(() => {
    setImportPkg(null);
    setImportPreview(null);
    setImportError(null);
  }, []);

  /** Add a built-in default model to the scene */
  const handleAddBuiltin = useCallback(
    (def: BuiltinModelDef) => {
      const state = useStore.getState();
      const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
      if (!state.activeNodeId || activeNode?.type !== "room") {
        state.showToast("전산실을 먼저 선택해주세요.", "error");
        return;
      }
      if (def.type === "Wall") {
        addImportedModel({
          name: "Wall",
          fileName: def.fileName,
          dataUrl: "",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isMoveEnabled: false,
          builtinType: "Wall",
          wallParams: { ...DEFAULT_WALL_PARAMS },
        });
      } else if (def.type === "Partition") {
        addImportedModel({
          name: "Partition",
          fileName: def.fileName,
          dataUrl: "",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isMoveEnabled: false,
          builtinType: "Partition",
          partitionParams: { ...DEFAULT_PARTITION_PARAMS },
        });
      } else if (def.type === "Clock") {
        addImportedModel({
          name: "Clock",
          fileName: def.fileName,
          dataUrl: "",
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isMoveEnabled: false,
          builtinType: "Clock",
        });
      } else if (def.type === "Light") {
        addImportedModel({
          name: "Light",
          fileName: def.fileName,
          dataUrl: "",
          position: [5, 10, 5],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isMoveEnabled: false,
          builtinType: "Light",
          lightParams: { ...DEFAULT_LIGHT_PARAMS },
        });
      } else {
        addImportedModel({
          name: def.label,
          fileName: def.fileName,
          dataUrl: def.assetUrl,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isMoveEnabled: false,
          builtinType: def.type,
        });
      }
    },
    [addImportedModel],
  );

  type PanelType = "hierarchy" | "serverRoomEnv" | "project" | "builtin" | "imported" | null;
  const [floatingPanel, setFloatingPanel] = useState<PanelType>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);

  const [treeHeight, setTreeHeight] = useState(300);
  const [isDraggingTree, setIsDraggingTree] = useState(false);

  const [floatingWidth, setFloatingWidth] = useState(300);
  const [floatingHeight, setFloatingHeight] = useState<number | string>("auto");
  const [floatingResizeMode, setFloatingResizeMode] = useState<"width" | "height" | "both" | null>(null);

  const [floatingTop, setFloatingTop] = useState(0);

  const toggleFloatingPanel = useCallback((panel: PanelType, e: React.MouseEvent<HTMLButtonElement>) => {
    if (panel === "serverRoomEnv" || panel === "builtin") {
      const state = useStore.getState();
      const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
      if (!state.activeNodeId || activeNode?.type !== "room") {
        state.showToast("전산실을 먼저 선택해주세요.", "error");
        return;
      }
    }
    const offsetTop = e.currentTarget.offsetTop;
    setFloatingPanel((prev) => {
      const isOpening = prev !== panel;
      if (isOpening) {
        setFloatingTop(offsetTop);
        setFloatingHeight("auto");
        return panel;
      }
      return null;
    });
  }, []);
  useEffect(() => {
    if (!isCollapsed) setFloatingPanel(null);
  }, [isCollapsed]);

  const handleSidebarResize = useCallback((e: MouseEvent) => {
    setSidebarWidth(e.clientX < 200 ? 200 : e.clientX > 600 ? 600 : e.clientX);
  }, []);

  const handleSidebarMouseUp = useCallback(() => {
    setIsDraggingSidebar(false);
  }, []);

  const handleTreeResize = useCallback((e: MouseEvent) => {
    // top offset is roughly 56px, plus 40px padding/header
    const newHeight = e.clientY - 60;
    setTreeHeight(newHeight < 100 ? 100 : newHeight > window.innerHeight - 200 ? window.innerHeight - 200 : newHeight);
  }, []);

  const handleTreeMouseUp = useCallback(() => {
    setIsDraggingTree(false);
  }, []);

  useEffect(() => {
    if (isDraggingSidebar) {
      document.body.classList.add("comm-no-select");
      window.addEventListener("mousemove", handleSidebarResize);
      window.addEventListener("mouseup", handleSidebarMouseUp);
    } else {
      document.body.classList.remove("comm-no-select");
      window.removeEventListener("mousemove", handleSidebarResize);
      window.removeEventListener("mouseup", handleSidebarMouseUp);
    }
    return () => {
      document.body.classList.remove("comm-no-select");
      window.removeEventListener("mousemove", handleSidebarResize);
      window.removeEventListener("mouseup", handleSidebarMouseUp);
    };
  }, [isDraggingSidebar, handleSidebarResize, handleSidebarMouseUp]);

  useEffect(() => {
    if (isDraggingTree) {
      document.body.classList.add("comm-no-select");
      window.addEventListener("mousemove", handleTreeResize);
      window.addEventListener("mouseup", handleTreeMouseUp);
    } else {
      document.body.classList.remove("comm-no-select");
      window.removeEventListener("mousemove", handleTreeResize);
      window.removeEventListener("mouseup", handleTreeMouseUp);
    }
    return () => {
      document.body.classList.remove("comm-no-select");
      window.removeEventListener("mousemove", handleTreeResize);
      window.removeEventListener("mouseup", handleTreeMouseUp);
    };
  }, [isDraggingTree, handleTreeResize, handleTreeMouseUp]);

  const handleFloatingResize = useCallback((e: MouseEvent) => {
    if (!floatingResizeMode) return;
    if (floatingResizeMode === "width" || floatingResizeMode === "both") {
      setFloatingWidth(Math.max(200, Math.min(e.clientX - 48, 800)));
    }
    if (floatingResizeMode === "height" || floatingResizeMode === "both") {
      setFloatingHeight(Math.max(200, Math.min(e.clientY, window.innerHeight - 20)));
    }
  }, [floatingResizeMode]);

  const handleFloatingMouseUp = useCallback(() => {
    setFloatingResizeMode(null);
  }, []);

  useEffect(() => {
    if (floatingResizeMode) {
      document.body.classList.add("comm-no-select");
      window.addEventListener("mousemove", handleFloatingResize);
      window.addEventListener("mouseup", handleFloatingMouseUp);
    } else {
      document.body.classList.remove("comm-no-select");
      window.removeEventListener("mousemove", handleFloatingResize);
      window.removeEventListener("mouseup", handleFloatingMouseUp);
    }
    return () => {
      document.body.classList.remove("comm-no-select");
      window.removeEventListener("mousemove", handleFloatingResize);
      window.removeEventListener("mouseup", handleFloatingMouseUp);
    };
  }, [floatingResizeMode, handleFloatingResize, handleFloatingMouseUp]);

  const selectedModel = importedModels.find((m) => m.id === selectedModelId);

  const handleImport = useCallback(
    async (file: File) => {
      if (!isValidExtension(file.name)) {
        setError("Unsupported format. Use .glb or .gltf only.");
        setTimeout(() => setError(null), 4000);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const dataUrl = await fileToDataUrl(file);
        const baseName = file.name.replace(/\.(glb|gltf)$/i, "");

        addImportedModel({
          name: baseName,
          fileName: file.name,
          dataUrl,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          isMoveEnabled: false,
        });
      } catch {
        setError("Failed to read file.");
        setTimeout(() => setError(null), 4000);
      } finally {
        setIsLoading(false);
      }
    },
    [addImportedModel],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImport(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleImport],
  );

  useEffect(() => {
    let dragTimeout: NodeJS.Timeout;

    const handleDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files") && isEditMode) {
        e.preventDefault();
      }
    };

    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files") && isEditMode) {
        e.preventDefault();
        setIsDragOver(true);

        clearTimeout(dragTimeout);
        dragTimeout = setTimeout(() => {
          setIsDragOver(false);
        }, 150);
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
      }
      clearTimeout(dragTimeout);
      setIsDragOver(false);
    };

    window.addEventListener("dragenter", handleDragEnter, { capture: true });
    window.addEventListener("dragover", handleDragOver, { capture: true });
    window.addEventListener("drop", handleDrop, { capture: true });

    return () => {
      clearTimeout(dragTimeout);
      window.removeEventListener("dragenter", handleDragEnter, { capture: true });
      window.removeEventListener("dragover", handleDragOver, { capture: true });
      window.removeEventListener("drop", handleDrop, { capture: true });
    };
  }, [isEditMode]);

  const renderServerRoomEnvPanel = () => {
    return (
      <div className="collapse-panel expanded" style={{ flexShrink: 0, height: "auto", minHeight: 0 }}>
        <div className="collapse-panel-header">
          <div className="comm-flex-center-10-flex1">
            <span className="comm-flex-center-8-noshrink">
              <span className="comm-icon-primary-lg">
                <Icon icon="ri:box-3-fill" className="icon comm-icon-md" />
              </span>
              <span className="tree-node-header-text">가상 공간</span>
            </span>
          </div>
          <div className="comm-flex-center-8-noshrink">
            <label className="switch" style={{ margin: 0 }} title={cyberSpaceEnabled ? "끄기" : "켜기"}>
              <input
                type="checkbox"
                checked={cyberSpaceEnabled}
                onChange={(e) => {
                  const state = useStore.getState();
                  const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
                  if (!state.activeNodeId || activeNode?.type !== "room") {
                    e.preventDefault();
                    state.showToast("전산실을 먼저 선택해주세요.", "error");
                    return;
                  }
                  state.setCyberSpaceEnabled(e.target.checked);
                }}
              />
              <span className="slider"></span>
            </label>
          </div>
        </div>
        {cyberSpaceEnabled && (
          <div
            className="collapse-panel-body"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px"
            }}
          >
            <div className="comm-flex-center-8-noshrink">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={csCustomSpaceSize}
                  onChange={(e) => {
                    const state = useStore.getState();
                    const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
                    if (!state.activeNodeId || activeNode?.type !== "room") {
                      e.preventDefault();
                      state.showToast("전산실을 먼저 선택해주세요.", "error");
                      return;
                    }
                    const checked = e.target.checked;
                    if (checked) {
                      useStore.getState().setCyberSpaceConfig({
                        csCustomSpaceSize: true,
                        csRoomWidthCm: Math.round(dynamicWidth * 100),
                        csRoomLengthCm: Math.round(dynamicLength * 100),
                        csOffsetXCm: 0,
                        csOffsetZCm: 0
                      });
                    } else {
                      useStore.getState().setCyberSpaceConfig({ csCustomSpaceSize: false });
                    }
                  }}
                />
                <span className="slider"></span>
              </label>
              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-primary)", fontWeight: 500 }}>
                공간 사이즈 고정(cm)
              </span>
            </div>

            <div className="mi-env-switch-wrapper" style={{ opacity: csCustomSpaceSize ? 1 : 0.5 }}>
              <div className="mi-input-group">
                <span className="mi-input-label">가로 (W)</span>
                <input
                  type="number"
                  className="comm-input-full mi-input-field"
                  min="300"
                  step="10"
                  value={displayWidthCm || ""}
                  disabled={!csCustomSpaceSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    useStore.getState().setCyberSpaceConfig({ csRoomWidthCm: isNaN(val) ? 0 : val });
                  }}
                  onBlur={(e) => {
                    const rawVal = parseInt(e.target.value);
                    if (rawVal < 300) {
                      setSizeWarning("공간 사이즈는 300cm 이상이어야 합니다.");
                      setTimeout(() => setSizeWarning(null), 3000);
                    }
                    const val = Math.max(300, rawVal || 300);
                    useStore.getState().setCyberSpaceConfig({ csRoomWidthCm: val });
                  }}
                />
              </div>
              <div style={{ paddingTop: "20px", color: "var(--text-secondary)", fontSize: "14px" }}>
                <Icon icon="mdi:close" />
              </div>
              <div className="mi-input-group">
                <span className="mi-input-label">세로 (D)</span>
                <input
                  type="number"
                  className="comm-input-full mi-input-field"
                  min="300"
                  step="10"
                  value={displayLengthCm || ""}
                  disabled={!csCustomSpaceSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    useStore.getState().setCyberSpaceConfig({ csRoomLengthCm: isNaN(val) ? 0 : val });
                  }}
                  onBlur={(e) => {
                    const rawVal = parseInt(e.target.value);
                    if (rawVal < 300) {
                      setSizeWarning("공간 사이즈는 300cm 이상이어야 합니다.");
                      setTimeout(() => setSizeWarning(null), 3000);
                    }
                    const val = Math.max(300, rawVal || 300);
                    useStore.getState().setCyberSpaceConfig({ csRoomLengthCm: val });
                  }}
                />
              </div>
            </div>

            <div className="mi-env-switch-wrapper" style={{ opacity: csCustomSpaceSize ? 1 : 0.5 }}>
              <div className="mi-input-group">
                <span className="mi-input-label">좌우 이동 (X)</span>
                <input
                  type="number"
                  className="comm-input-full mi-input-field"
                  step="10"
                  value={csCustomSpaceSize ? csOffsetXCm || 0 : 0}
                  disabled={!csCustomSpaceSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    useStore.getState().setCyberSpaceConfig({ csOffsetXCm: isNaN(val) ? 0 : val });
                  }}
                />
              </div>
              <div style={{ paddingTop: "20px", color: "transparent", fontSize: "14px" }}>
                <Icon icon="mdi:close" />
              </div>
              <div className="mi-input-group">
                <span className="mi-input-label">앞뒤 이동 (Z)</span>
                <input
                  type="number"
                  className="comm-input-full mi-input-field"
                  step="10"
                  value={csCustomSpaceSize ? csOffsetZCm || 0 : 0}
                  disabled={!csCustomSpaceSize}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    useStore.getState().setCyberSpaceConfig({ csOffsetZCm: isNaN(val) ? 0 : val });
                  }}
                />
              </div>
            </div>
            {sizeWarning && (
              <div style={{ color: "var(--color-danger, #ef4444)", fontSize: "12px", marginTop: "-4px" }}>
                {sizeWarning}
              </div>
            )}

          </div>
        )}
      </div>
    );
  };

  const renderBuiltinPanel = () => (
    <div className="collapse-panel expanded" style={{ flexShrink: 0, height: "auto", minHeight: 0 }}>
      <div className="collapse-panel-header">
        <div className="comm-flex-center-10-flex1">
          <span className="comm-flex-center-8-noshrink">
            <span className="comm-icon-primary-lg">
              <Icon icon="lucide:library" className="icon comm-icon-md" />
            </span>
            <span className="tree-node-header-text">에셋 라이브러리</span>
          </span>
        </div>
      </div>
      <div className="collapse-panel-body">
        <div className="comm-grid-2col-8">
          {BUILTIN_MODELS.filter(def => !def.hidden).map((def) => (
            <button
              key={def.type}
              className="comm-btn comm-btn-md comm-btn-tertiary comm-w-full"
              onClick={() => handleAddBuiltin(def)}
            >
              <Icon icon={def.icon} className="icon asset-lib-icon" width="18" height="18" /> {def.label}
            </button>
          ))}
        </div>
        <div style={{ borderTop: "1px solid var(--border-color)", marginTop: "12px", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            className="comm-btn comm-btn-md comm-btn-primary comm-w-full"
            onClick={() => {
              const state = useStore.getState();
              const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
              if (!state.activeNodeId || activeNode?.type !== "room") {
                state.showToast("전산실을 먼저 선택해주세요.", "error");
                return;
              }
              window.open('/arcVRoom/', '_blank');
            }}
          >
            <Icon icon="mdi:cube-outline" className="icon" style={{ marginRight: '6px' }} />
            3D공간 제작
          </button>
          <button
            className="comm-btn comm-btn-md comm-btn-secondary comm-w-full"
            onClick={() => {
              const state = useStore.getState();
              const activeNode = state.nodes.find(n => n.nodeId === state.activeNodeId);
              if (!state.activeNodeId || activeNode?.type !== "room") {
                state.showToast("전산실을 먼저 선택해주세요.", "error");
                return;
              }
              fileInputRef.current?.click();
            }}
            disabled={isLoading}
          >
            <Icon icon="mdi:file-upload-outline" className="icon" style={{ marginRight: '6px' }} />
            에셋 가져오기
          </button>
        </div>
      </div>
    </div>
  );

  const renderProjectPanel = () => (
    <div className="collapse-panel expanded" style={{ flexShrink: 0, height: "auto", minHeight: 0 }}>
      <div className="collapse-panel-header">
        <div className="comm-flex-center-10-flex1">
          <span className="comm-flex-center-8-noshrink">
            <span className="comm-icon-primary-lg">
              <Icon icon="material-symbols:folder" className="icon comm-icon-md" />
            </span>
            <span className="tree-node-header-text">에셋 레이아웃</span>
          </span>
        </div>
      </div>
      <div className="collapse-panel-body">
        <div className="comm-flex-col-10">
          <div>

            <div className="comm-flex-gap-8">
              <button
                className="comm-btn comm-btn-md comm-btn-secondary comm-flex-1"
                disabled={importedModels.length === 0}
                onClick={handleExportModels}
              >
                <Icon icon="material-symbols:download" className="icon" /> 내보내기
              </button>
              <button
                className="comm-btn comm-btn-md comm-btn-secondary comm-flex-1"
                onClick={() => modelImportRef.current?.click()}
              >
                <Icon icon="material-symbols:upload" className="icon" /> 불러오기
              </button>
            </div>
            {(successMsg || error || importError) && (
              <div style={{ marginTop: "8px", fontSize: "10px", color: error || importError ? "#ef4444" : "#22c55e", fontWeight: 500, textAlign: "center", padding: "6px", background: error || importError ? "rgba(239, 68, 68, 0.05)" : "rgba(34, 197, 94, 0.05)", borderRadius: "4px", border: "1px solid", borderColor: error || importError ? "rgba(239, 68, 68, 0.1)" : "rgba(34, 197, 94, 0.1)" }}>
                {(error || importError || successMsg)?.replace("Exported", "Saved").replace("Import", "Load")}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderImportedPanel = () => {
    return (
      <div className="collapse-panel expanded" style={{ flexShrink: 0, height: "auto", minHeight: 0 }}>
        <div className="collapse-panel-header">
          <div className="comm-flex-center-10-flex1" style={{ justifyContent: "space-between" }}>
            <span className="comm-flex-center-8-noshrink">
              <span className="comm-icon-primary-lg">
                <Icon icon="ph:stack-fill" className="icon comm-icon-md" />
              </span>
              <span className="tree-node-header-text">오브젝트 레이어 ({importedModels.length})</span>
            </span>
            <button
              className="comm-icon-btn"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              disabled={isLoading}
              title="Add New Asset"
              style={{ padding: "4px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: isLoading ? "not-allowed" : "pointer" }}
            >
              {isLoading ? <span className="spinner-mini" style={{ width: 16, height: 16 }} /> : <Icon icon="material-symbols:add" style={{ fontSize: "20px", color: "var(--text-secondary)" }} />}
            </button>
          </div>
        </div>
        <div className="collapse-panel-body" style={{ overflowY: "auto", maxHeight: "260px" }}>
          {importedModels.length === 0 ? (
            <div className="mi-layer-empty">
              <Icon icon="mdi:package-variant-closed" style={{ fontSize: "24px", opacity: 0.5 }} />
              <span>Empty Layer</span>
            </div>
          ) : (
            importedModels.map((m) => {
              const isSelected = selectedModelId === m.id;
              return (
                <div
                  key={m.id}
                  onClick={() => selectModel(selectedModelId === m.id ? null : m.id)}
                  className={`mi-layer-item ${isSelected ? "is-selected" : ""}`}
                >
                  <div className="mi-layer-dot" />
                  <span className="mi-layer-name">
                    {m.name}
                  </span>
                  <div className="mi-layer-actions">
                    <button
                      className={`mi-layer-btn ${m.isMoveEnabled ? "is-unlocked" : "is-locked"}`}
                      title={m.isMoveEnabled ? "잠금 해제됨" : "잠금됨"}
                      onClick={(e) => { e.stopPropagation(); toggleModelMove(m.id); }}
                    >
                      <Icon icon={m.isMoveEnabled ? "mdi:lock-open-outline" : "mdi:lock-outline"} />
                    </button>
                    <button
                      className="mi-layer-btn is-delete"
                      title="삭제"
                      onClick={(e) => { e.stopPropagation(); deleteModel(m.id); }}
                    >
                      <Icon icon="mdi:trash-can-outline" />
                    </button>
                  </div>
                </div>
              );
            }))}
        </div>
      </div>
    );
  };

  const hasRoom = nodes.some(n => n.type === "room");
  const showInitialTooltip = isEditMode && !hasRoom;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        className="comm-hidden"
        onChange={handleFileChange}
      />
      <input
        ref={modelImportRef}
        type="file"
        accept=".json"
        className="comm-hidden"
        onChange={handleModelImportFile}
      />

      <div className="mi-main-wrapper">
        <div
          className={`mi-sidebar ${isCollapsed ? 'sidebar-fold' : ''} ${isDraggingSidebar ? 'no-transition' : ''}`}
          style={isCollapsed ? undefined : { width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px` }}
        >
          {/* Universal Toggle Button */}
          <div className="mi-collapse-btn-wrapper">
            <button
              onClick={() => {
                if (isCollapsed) {
                  setIsCollapsed(false);
                } else {
                  setIsCollapsed(true);
                  setFloatingPanel(null); // Close floating panels when collapsing
                }
              }}
              className="mi-collapse-btn"
              title={isCollapsed ? "사이드바 열기" : "사이드바 닫기"}
            >
              {isCollapsed ? "»" : "«"}
            </button>
          </div>

          {/* Folded State: Icon Toolbar */}
          <div className="sidebar-icon-toolbar">
            <button
              className={`sidebar-tab-btn ${floatingPanel === "hierarchy" ? "active" : ""}`}
              onClick={(e) => toggleFloatingPanel("hierarchy", e)}
              title="구조 (Hierarchy)"
            >
              <Icon icon="icon-park-solid:network-tree" className="icon" />
            </button>
            {isEditMode && (
              <div style={{
                display: "contents",
                ...(showInitialTooltip && {
                  opacity: 0.3,
                  pointerEvents: "none"
                })
              }}>
                <button
                  className={`sidebar-tab-btn ${floatingPanel === "serverRoomEnv" ? "active" : ""}`}
                  onClick={(e) => toggleFloatingPanel("serverRoomEnv", e)}
                  title="가상 공간"
                >
                  <Icon icon="ri:box-3-fill" className="icon" />
                </button>
                <button
                  className={`sidebar-tab-btn ${floatingPanel === "builtin" ? "active" : ""}`}
                  onClick={(e) => toggleFloatingPanel("builtin", e)}
                  title="에셋 라이브러리 (Asset Library)"
                >
                  <Icon icon="lucide:library" className="icon" />
                </button>
                <button
                  className={`sidebar-tab-btn ${floatingPanel === "project" ? "active" : ""}`}
                  onClick={(e) => toggleFloatingPanel("project", e)}
                  title="프로젝트 & 에셋 (Project)"
                >
                  <Icon icon="material-symbols:folder" className="icon" />
                </button>
                <button
                  className={`sidebar-tab-btn ${floatingPanel === "imported" ? "active" : ""}`}
                  onClick={(e) => toggleFloatingPanel("imported", e)}
                  title="오브젝트 레이어 (Object Layer)"
                >
                  <Icon icon="ph:stack-fill" className="icon" />
                </button>
              </div>
            )}
          </div>

          {/* Expanded State: Stacked Panels */}
          <div className="sidebar-expanded-content">
            <div
              className="sidebar-tree-area"
              style={{
                height: isEditMode ? `${treeHeight}px` : "100%",
                flex: isEditMode ? "none" : 1,
                position: "relative"
              }}
            >
              <HierarchyTree />
              {showInitialTooltip && !isCollapsed && (
                <div style={{
                  position: "absolute",
                  left: "100%",
                  top: "40px",
                  marginLeft: "16px",
                  width: "260px",
                  background: "var(--theme-primary)",
                  color: "#fff",
                  padding: "16px",
                  borderRadius: "8px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                  zIndex: 999,
                  fontSize: "14px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "8px"
                }}>
                  <div style={{
                    position: "absolute",
                    left: "-8px",
                    top: "16px",
                    borderStyle: "solid",
                    borderWidth: "8px 8px 8px 0",
                    borderColor: "transparent var(--theme-primary) transparent transparent"
                  }} />
                  <Icon icon="mdi:information" style={{ fontSize: "20px" }} />
                  Root아래에 전산실을 생성하세요
                </div>
              )}
            </div>

            <div
              onMouseDown={() => setIsDraggingTree(true)}
              className="sidebar-tree-resizer"
              style={{
                display: isEditMode ? "block" : "none",
                background: isDraggingTree ? "var(--theme-primary)" : "transparent",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "var(--theme-primary)")}
              onMouseOut={(e) => (e.currentTarget.style.background = isDraggingTree ? "var(--theme-primary)" : "transparent")}
            />

            <div
              className="sidebar-panels-area"
              style={{
                display: isEditMode ? "flex" : "none",
                ...(showInitialTooltip && {
                  opacity: 0.3,
                  pointerEvents: "none"
                })
              }}
            >
              {isEditMode && renderServerRoomEnvPanel()}
              {isEditMode && renderBuiltinPanel()}
              {isEditMode && renderProjectPanel()}
              {isEditMode && renderImportedPanel()}
            </div>
          </div>

          {/* Resize Handle (only active when expanded) */}
          <div
            className={`sidebar-resize-handle ${isDraggingSidebar ? 'dragging' : ''}`}
            onMouseDown={() => setIsDraggingSidebar(true)}
          />

          {/* Floating Panel Popup (only active when collapsed) */}
          {floatingPanel && isCollapsed && (
            <div
              className="sidebar-floating-panel"
              style={{
                width: `${floatingWidth}px`,
                top: `${floatingTop}px`,
              }}
            >
              <div
                className="sidebar-floating-header"
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "6px",
                  marginBottom: 0,
                  zIndex: 10
                }}
              >
                <button
                  onClick={() => setFloatingPanel(null)}
                  className="sidebar-floating-close"
                  style={{ background: "transparent", border: "none" }}
                >
                  ×
                </button>
              </div>

              <div
                className="sidebar-floating-content"
                style={{
                  height: typeof floatingHeight === "number" ? `${floatingHeight}px` : floatingHeight,
                }}
              >
                {floatingPanel === "hierarchy" && <HierarchyTree />}
                {floatingPanel === "serverRoomEnv" && isEditMode && renderServerRoomEnvPanel()}
                {floatingPanel === "builtin" && isEditMode && renderBuiltinPanel()}
                {floatingPanel === "project" && isEditMode && renderProjectPanel()}
                {floatingPanel === "imported" && isEditMode && renderImportedPanel()}
              </div>

              <div id={isCollapsed ? "equipment-panel-portal" : "equipment-panel-portal-hidden-floating"} className="sidebar-portal-target" />

              <div onMouseDown={() => setFloatingResizeMode("width")} className="floating-resize-e" />
              <div onMouseDown={() => setFloatingResizeMode("height")} className="floating-resize-s" />
              <div onMouseDown={() => setFloatingResizeMode("both")} className="floating-resize-se" />
            </div>
          )}
        </div>
      </div>

      {/* Equipment Panel Portal Target - Sibling of sidebar to avoid backdrop-filter stacking issues */}
      <div
        id={isCollapsed ? "equipment-panel-portal-hidden" : "equipment-panel-portal"}
        className="sidebar-portal-target"
        style={{
          left: isCollapsed ? 60 : sidebarWidth,
          width: 0
        }}
      />

      {/* Properties Section — positioned right next to the left panel */}
      {isEditMode && selectedModel && (
        <div
          style={{
            position: "absolute",
            top: "76px",
            left: "324px",
            zIndex: 100,
            width: "300px",
            maxHeight: "calc(100vh - 160px)",
            overflowY: "auto",
          }}
        >
          <ModelProperties
            model={selectedModel}
            onUpdate={(updates) => updateModel(selectedModel.id, updates)}
            onDelete={() => deleteModel(selectedModel.id)}
          />
        </div>
      )}

      {isEditMode && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: isDragOver ? 1000 : -1,
            pointerEvents: isDragOver ? "auto" : "none",
            background: isDragOver ? "rgba(79, 70, 229, 0.08)" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            backdropFilter: isDragOver ? "blur(4px)" : "none",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleImport(file);
          }}
        >
          {isDragOver && (
            <div
              className="comm-drag-overlay"
              style={{ pointerEvents: 'none' }}
            >
              <div className="comm-icon-64">📦</div>
              <div
                className="comm-title-lg"
              >
                Ready to Import
              </div>
              <div
                className="comm-subtitle-md"
              >
                Drop your GLB or GLTF file to add it
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import Preview Modal */}
      {importPreview && importPkg && (
        <div
          className="comm-modal-overlay-blur"
          onClick={handleCancelImport}
        >
          <div
            className="comm-modal-dialog-420"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="comm-modal-header-flex"
            >
              📥 Import Preview
            </h3>

            {/* Summary stats */}
            <div
              className="comm-grid-3col-10-mb20"
            >
              {[
                {
                  label: "Total",
                  value: importPreview.totalCount,
                  color: "#6366f1",
                },
                {
                  label: "Built-in",
                  value: importPreview.builtinCount + importPreview.wallCount,
                  color: "#06b6d4",
                },
                {
                  label: "Imported",
                  value: importPreview.importedCount,
                  color: "#f59e0b",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="comm-box-card"
                >
                  <div
                    style={{
                      fontSize: "22px",
                      fontWeight: 700,
                      color: stat.color,
                    }}
                  >
                    {stat.value}
                  </div>
                  <div
                    className="comm-label-uppercase-mt4"
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Model list */}
            <div
              className="comm-list-box-scrollable"
            >
              <div
                className="comm-label-uppercase comm-mb-8"
              >
                Models to import
              </div>
              {importPreview.modelNames.map((name, idx) => {
                const m = importPkg.models[idx];
                const def = BUILTIN_MODELS.find(b => b.type === m.builtinType);
                const iconName = def ? def.icon : "mdi:package-variant-closed";
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "6px 0",
                      borderBottom:
                        idx < importPreview.modelNames.length - 1
                          ? "1px solid var(--border-weak)"
                          : "none",
                      fontSize: "12px",
                      color: "var(--text-secondary)",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <Icon icon={iconName} style={{ fontSize: '14px' }} />
                    <span className="comm-flex-1">{name}</span>
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: m.isMoveEnabled
                          ? "rgba(34,197,94,0.1)"
                          : "rgba(249,115,22,0.08)",
                        color: m.isMoveEnabled ? "#16a34a" : "#f97316",
                      }}
                    >
                      {m.isMoveEnabled ? "Unlocked" : "Locked"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Schema info */}
            <div
              className="comm-text-tertiary-sm comm-mb-20"
            >
              Schema v{importPkg.schemaVersion} · exported{" "}
              {new Date(importPkg.exportedAt).toLocaleString()}
            </div>

            {/* Actions */}
            <div className="comm-flex-gap-10">
              <button
                className={`comm-btn-primary ${isImporting ? "waiting" : ""}`}
                disabled={isImporting}
                onClick={handleConfirmImport}
              >
                {isImporting
                  ? "Importing..."
                  : `Import ${importPreview.totalCount} Model(s)`}
              </button>
              <button
                className="comm-btn-secondary"
                onClick={handleCancelImport}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface ModelPropertiesProps {
  model: ImportedModel;
  onUpdate: (updates: Partial<Omit<ImportedModel, "id">>) => void;
  onDelete: () => void;
}

/** Helper to update a single wall param field */
const updateWallParam = (
  model: ImportedModel,
  onUpdate: ModelPropertiesProps["onUpdate"],
  field: keyof WallParams,
  value: number | string,
) => {
  const current = model.wallParams ?? DEFAULT_WALL_PARAMS;
  onUpdate({ wallParams: { ...current, [field]: value } });
};

/** Helper to update a single partition param field */
const updatePartitionParam = (
  model: ImportedModel,
  onUpdate: ModelPropertiesProps["onUpdate"],
  field: keyof PartitionParams,
  value: PartitionParams[keyof PartitionParams],
) => {
  const current = model.partitionParams ?? DEFAULT_PARTITION_PARAMS;
  onUpdate({ partitionParams: { ...current, [field]: value } });
};

/** Helper to update a single light param field */
const updateLightParam = (
  model: ImportedModel,
  onUpdate: ModelPropertiesProps["onUpdate"],
  field: keyof LightParams,
  value: number | string | boolean,
) => {
  const current = model.lightParams ?? DEFAULT_LIGHT_PARAMS;
  onUpdate({ lightParams: { ...current, [field]: value } });
};

const ModelProperties = ({
  model,
  onUpdate,
  onDelete,
}: ModelPropertiesProps) => {

  const numInput = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 0.1,
  ) => (
    <div
      className="comm-flex-col-4-flex1"
    >
      <span
        className="comm-label-sm-center"
      >
        {label}
      </span>
      <input
        type="number"
        value={Number(value.toFixed(3))}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="comm-input-center-sm"
      />
    </div>
  );

  const vec3Block = (
    label: string,
    values: [number, number, number],
    onChange: (v: [number, number, number]) => void,
    step = 0.1,
  ) => (
    <div className="comm-mb-16">
      <label
        className="comm-label-block"
      >
        {label}
      </label>
      <div className="comm-flex-gap-8">
        {numInput(
          "X",
          values[0],
          (v) => onChange([v, values[1], values[2]]),
          step,
        )}
        {numInput(
          "Y",
          values[1],
          (v) => onChange([values[0], v, values[2]]),
          step,
        )}
        {numInput(
          "Z",
          values[2],
          (v) => onChange([values[0], values[1], v]),
          step,
        )}
      </div>
    </div>
  );

  return (
    <div
      className="comm-panel-content-scrollable"
    >
      <div className="comm-mb-20">
        <input
          type="text"
          value={model.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Model Name"
          className="comm-input-title"
          onFocus={(e) =>
            (e.currentTarget.style.borderBottomColor = "var(--theme-primary)")
          }
          onBlur={(e) =>
            (e.currentTarget.style.borderBottomColor = "var(--border-weak)")
          }
        />
      </div>

      {vec3Block("Position", model.position, (v) => onUpdate({ position: v }))}
      {vec3Block(
        "Rotation (°)",
        [
          (model.rotation[0] * 180) / Math.PI,
          (model.rotation[1] * 180) / Math.PI,
          (model.rotation[2] * 180) / Math.PI,
        ],
        (v) =>
          onUpdate({
            rotation: [
              (v[0] * Math.PI) / 180,
              (v[1] * Math.PI) / 180,
              (v[2] * Math.PI) / 180,
            ],
          }),
        15,
      )}
      {vec3Block("Scale", model.scale, (v) => onUpdate({ scale: v }), 0.1)}

      {/* Wall-specific parametric controls */}
      {model.builtinType === "Wall" &&
        (() => {
          const wp = model.wallParams ?? DEFAULT_WALL_PARAMS;
          return (
            <div className="comm-mb-16">
              <label
                className="comm-label-block"
              >
                Wall Parameters
              </label>
              <div className="comm-flex-gap-8 comm-mb-8">
                {numInput(
                  "Height",
                  wp.height,
                  (v) =>
                    updateWallParam(
                      model,
                      onUpdate,
                      "height",
                      Math.max(0.1, v),
                    ),
                  0.5,
                )}
                {numInput(
                  "Length",
                  wp.length,
                  (v) =>
                    updateWallParam(
                      model,
                      onUpdate,
                      "length",
                      Math.max(0.1, v),
                    ),
                  0.5,
                )}
                {numInput(
                  "Thick",
                  wp.thickness,
                  (v) =>
                    updateWallParam(
                      model,
                      onUpdate,
                      "thickness",
                      Math.max(0.01, v),
                    ),
                  0.05,
                )}
              </div>
              <div
                className="comm-flex-center-8"
              >
                <span
                  className="comm-label-sm"
                >
                  COLOR
                </span>
                <input
                  type="color"
                  value={wp.color}
                  onChange={(e) =>
                    updateWallParam(model, onUpdate, "color", e.target.value)
                  }
                  className="comm-btn-icon-small"
                />
                <span
                  className="comm-text-tertiary-sm"
                >
                  {wp.color}
                </span>
              </div>
            </div>
          );
        })()}

      {/* Partition-specific parametric controls */}
      {model.builtinType === "Partition" &&
        (() => {
          const pp = model.partitionParams ?? DEFAULT_PARTITION_PARAMS;
          const isTransparent = pp.visibilityMode === "transparent";

          return (
            <div className="comm-mb-16">
              <label
                className="comm-label-block"
              >
                Partition Parameters
              </label>
              <div
                className="comm-flex-gap-8 comm-mb-12"
              >
                {numInput(
                  "Height",
                  pp.height,
                  (v) =>
                    updatePartitionParam(
                      model,
                      onUpdate,
                      "height",
                      Math.max(0.1, v),
                    ),
                  0.5,
                )}
                {numInput(
                  "Length",
                  pp.length,
                  (v) =>
                    updatePartitionParam(
                      model,
                      onUpdate,
                      "length",
                      Math.max(0.1, v),
                    ),
                  0.5,
                )}
                {numInput(
                  "Thick",
                  pp.thickness,
                  (v) =>
                    updatePartitionParam(
                      model,
                      onUpdate,
                      "thickness",
                      Math.max(0.01, v),
                    ),
                  0.05,
                )}
              </div>

              {/* Transparency Toggle */}
              <div className="comm-mb-12">
                <span
                  className="comm-label-sm-header"
                >
                  Transparency
                </span>
                <div className="comm-flex-gap-4">
                  <button
                    onClick={() =>
                      updatePartitionParam(
                        model,
                        onUpdate,
                        "visibilityMode",
                        "transparent",
                      )
                    }
                    className={`comm-btn-tab ${isTransparent ? "active" : "inactive"}`}
                  >
                    반투명
                  </button>
                  <button
                    onClick={() =>
                      updatePartitionParam(
                        model,
                        onUpdate,
                        "visibilityMode",
                        "opaque",
                      )
                    }
                    className={`comm-btn-tab ${!isTransparent ? "active" : "inactive"}`}
                  >
                    불투명
                  </button>
                </div>
              </div>

              <div
                className="comm-flex-center-8"
              >
                <span
                  className="comm-label-sm"
                >
                  COLOR
                </span>
                <input
                  type="color"
                  value={pp.color}
                  onChange={(e) =>
                    updatePartitionParam(
                      model,
                      onUpdate,
                      "color",
                      e.target.value,
                    )
                  }
                  className="comm-btn-icon-small"
                />
                <span
                  className="comm-text-tertiary-sm"
                >
                  {pp.color}
                </span>
              </div>
            </div>
          );
        })()}

      {/* Light-specific parametric controls */}
      {model.builtinType === "Light" &&
        (() => {
          const lp = model.lightParams ?? DEFAULT_LIGHT_PARAMS;
          return (
            <div className="comm-mb-16">
              <label
                className="comm-label-block"
              >
                Light Parameters
              </label>
              <div className="comm-flex-gap-8 comm-mb-12">
                {numInput(
                  "Intensity",
                  lp.intensity,
                  (v) =>
                    updateLightParam(
                      model,
                      onUpdate,
                      "intensity",
                      Math.max(0, v),
                    ),
                  0.1,
                )}
                {numInput(
                  "Shadow Res",
                  lp.shadowMapSize,
                  (v) => {
                    const clamped = Math.min(4096, Math.max(256, v));
                    updateLightParam(
                      model,
                      onUpdate,
                      "shadowMapSize",
                      clamped,
                    );
                  },
                  256,
                )}
              </div>

              {/* Shadow Toggle */}
              <div className="comm-mb-12">
                <span
                  className="comm-label-sm-header"
                >
                  Shadow
                </span>
                <div className="comm-flex-gap-4">
                  <button
                    onClick={() =>
                      updateLightParam(model, onUpdate, "castShadow", true)
                    }
                    className={`comm-btn-tab ${lp.castShadow ? "active" : "inactive"}`}
                  >
                    ON
                  </button>
                  <button
                    onClick={() =>
                      updateLightParam(model, onUpdate, "castShadow", false)
                    }
                    className={`comm-btn-tab ${!lp.castShadow ? "active" : "inactive"}`}
                  >
                    OFF
                  </button>
                </div>
              </div>

              {/* Color picker */}
              <div
                className="comm-flex-center-8"
              >
                <span
                  className="comm-label-sm"
                >
                  COLOR
                </span>
                <input
                  type="color"
                  value={lp.color}
                  onChange={(e) =>
                    updateLightParam(model, onUpdate, "color", e.target.value)
                  }
                  className="comm-btn-icon-small"
                />
                <span
                  className="comm-text-tertiary-sm"
                >
                  {lp.color}
                </span>
              </div>
            </div>
          );
        })()}

      <div
        className="comm-mt-24 comm-flex-col-10"
      >
        <button
          className="comm-btn"
          style={{
            width: "100%",
            height: "36px",
            fontSize: "12px",
            fontWeight: 600,
            background: model.isMoveEnabled
              ? "rgba(34, 197, 94, 0.1)"
              : "rgba(249, 115, 22, 0.08)",
            color: model.isMoveEnabled ? "#16a34a" : "#ea580c",
            border: "1px solid",
            borderColor: model.isMoveEnabled
              ? "rgba(34, 197, 94, 0.3)"
              : "rgba(249, 115, 22, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
          }}
          onClick={() => useStore.getState().toggleModelMove(model.id)}
        >
          {model.isMoveEnabled ? "🔓 Move Enabled" : "🔒 Move Locked"}
        </button>

        <div className="comm-flex-gap-8">
          <button
            className="comm-btn"
            style={{
              flex: 1,
              height: "36px",
              fontSize: "12px",
              background: "rgba(128, 128, 128, 0.1)",
              border: "1px solid var(--border-medium)",
              color: "var(--text-primary)",
            }}
            onClick={() => {
              const { addImportedModel } = useStore.getState();

              const { id, ...modelData } = model;
              addImportedModel({
                ...modelData,
                name: `${modelData.name} (copy)`,
                position: [
                  modelData.position[0] + 0.5,
                  modelData.position[1],
                  modelData.position[2] + 0.5,
                ],
              });
            }}
          >
            Duplicate
          </button>
          <button
            className="comm-btn"
            style={{
              flex: 1,
              height: "36px",
              fontSize: "12px",
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#ef4444",
            }}
            onClick={onDelete}
          >
            Delete
          </button>
        </div>


      </div>
    </div>
  );
};
