import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Loader2Icon, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { ModelConfigObject } from "@zcode/provider";
import type {
  ProviderModelDraftValues,
  ProviderModelDraftCommitResult,
} from "@/settings/model-provider-section/ProviderModelMetadata.js";
import { ProviderModelInputModalityOptions } from "@/settings/model-provider-section/ProviderModelModalityOptions.js";
import { BooleanModelOption } from "@/settings/model-provider-section/ProviderModelMetadataFields.js";
import {
  ModelSettingsGroup,
  ProviderModelReasoningSettings,
} from "@/settings/model-provider-section/ProviderModelSettingsGroups.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import { TECHNICAL_INPUT_ATTRIBUTES } from "@/lib/technicalInputAttributes.js";
import {
  ProviderModelMetadataDialogActions,
  ModelSmartConfigSwitch,
  ModelConfigDraftFeedback,
  ModelConfigRestoreButton,
} from "@/settings/model-provider-section/ProviderModelMetadataDialogActions.js";
import { modelEditorControlStyle } from "@/settings/model-provider-section/modelEditorControlStyle.js";
import { cn } from "@/components/lib/utils.js";
import {
  ModelConfigHelp,
  ModelConfigInputLabel,
} from "@/settings/model-provider-section/ModelConfigHelp.js";

import { ModelEditorAdvanced } from "@/settings/model-provider-section/ModelEditorAdvanced.js";

export function selectFocusedInputText(event: Pick<FocusEvent<HTMLInputElement>, "currentTarget">) {
  event.currentTarget.select();
}

export function ProviderModelMetadataDialog({
  mode = "edit",
  open,
  draft,
  draftErrorMessage,
  draftErrorField,
  personalConfig,
  overrideFields,
  inheritedConfig,
  onOpenChange,
  onDraftChange,
  onRestore,
  onCommit,
  modelConfigResolutionPending = false,
  modelIdReadOnly = false,
  saving = false,
  modelDefaultsLoaded = false,
  fetchAvailableModels,
  onModelIdBlur,
}: {
  mode?: "add" | "edit";
  open: boolean;
  draft: ProviderModelDraftValues;
  draftErrorMessage: string | null;
  draftErrorField?: Extract<ProviderModelDraftCommitResult, { status: "invalid" }>["field"] | null;
  personalConfig?: ModelConfigObject;
  overrideFields?: ReadonlySet<string>;
  inheritedConfig?: ModelConfigObject;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (patch: Partial<ProviderModelDraftValues>) => void;
  onRestore?: () => void;
  onCommit: () => boolean | Promise<boolean>;
  modelConfigResolutionPending?: boolean;
  modelIdReadOnly?: boolean;
  saving?: boolean;
  modelDefaultsLoaded?: boolean;
  fetchAvailableModels?: () => Promise<{ models: readonly string[] }>;
  onModelIdBlur?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [validationAttempt, setValidationAttempt] = useState(0);
  const commit = async () => {
    const result = await onCommit();
    if (!result) setValidationAttempt((value) => value + 1);
  };
  const contextWindowInputId = useId();
  const maxOutputInputId = useId();
  const smart = draft.useRecommendedConfigValue !== false;
  const activeOverrides = smart ? overrideFields : new Set<string>();
  const overridden = (field: string, legacy = false) =>
    smart && (activeOverrides ? activeOverrides.has(field) : legacy);
  const editModelLabel = intl.formatMessage({
    id: "settings.modelProvider.editModel",
  });
  // 新增模型时模型 ID 为空，如果沿用编辑态的上下文窗口自动聚焦，会让用户先落到默认数值字段。
  // 编辑态仍保留上下文窗口自动聚焦和选中，方便直接修改已有模型配置。
  const shouldFocusModelIdInput = mode === "add";
  const shouldFocusContextWindowInput = mode === "edit";
  const addModelConfigResolutionPending = smart && modelConfigResolutionPending;
  const compositionActiveRef = useRef(false);
  const [fetchState, setFetchState] = useState<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "error"; message: string }
    | { phase: "ready"; models: readonly string[] }
  >({ phase: "idle" });
  const [fetchFilter, setFetchFilter] = useState("");
  const fetchingModels = fetchState.phase === "loading";
  const fetchedModels =
    fetchState.phase === "ready"
      ? fetchState.models.filter((model) =>
          model.toLowerCase().includes(fetchFilter.trim().toLowerCase()),
        )
      : [];
  const handleFetchAvailableModels = async () => {
    if (!fetchAvailableModels || fetchingModels) return;
    setFetchState({ phase: "loading" });
    setFetchFilter("");
    try {
      const { models } = await fetchAvailableModels();
      setFetchState({ phase: "ready", models });
    } catch (error) {
      setFetchState({
        phase: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const handleTechnicalInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }
    // 输入法候选确认也会发出 Enter。某些 Electron/macOS 版本的
    // nativeEvent.isComposing 会过早恢复 false，因此同时保留本地 composition 状态。
    if (
      isImeComposingKeyEvent({
        compositionActive: compositionActiveRef.current,
        nativeEvent: event.nativeEvent,
      })
    ) {
      return;
    }
    event.preventDefault();
    void commit();
  };
  const handleCompositionStart = () => {
    compositionActiveRef.current = true;
  };
  const handleCompositionEnd = () => {
    compositionActiveRef.current = false;
  };
  const maxOutputTokensInputDisabled = mode === "add" && !draft.idValue.trim();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mode === "edit" ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 p-0"
            aria-label={editModelLabel}
            title={editModelLabel}
          >
            <Pencil className="size-3.5 text-foreground-subtle" />
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        // overflow-hidden 仍允许聚焦触发外层滚动；语言换行后曾滚走标题。仅正文滚动，外框只裁切。
        className="max-h-[min(48rem,calc(100vh-4rem))] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-clip"
        data-no-model-drag="true"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">
            {intl.formatMessage({
              id:
                mode === "add"
                  ? "settings.modelProvider.addModel"
                  : "settings.modelProvider.editModel",
            })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {intl.formatMessage({
              id: "settings.modelProvider.editModelDescription",
            })}
          </DialogDescription>
          <ModelSmartConfigSwitch
            disabled={saving}
            checked={smart}
            onChange={(useRecommendedConfigValue) => onDraftChange({ useRecommendedConfigValue })}
          />
        </DialogHeader>
        {/* 保存期间锁定正文交互，不改变原有滚动容器；页脚单独显示提交状态。 */}
        <div
          inert={saving}
          className="min-h-0 min-w-0 -mr-3 space-y-4 overflow-y-auto pr-4"
          data-model-settings-scroll="true"
        >
          <ModelSettingsGroup group="basic">
            <div data-model-identity-row="true" className="flex flex-col gap-4">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-ui-base text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.modelProvider.modelId" })}
                </label>
                <Input
                  {...TECHNICAL_INPUT_ATTRIBUTES}
                  type="text"
                  autoFocus={shouldFocusModelIdInput}
                  size="lg"
                  className={cn("font-mono", modelEditorControlStyle(false))}
                  readOnly={modelIdReadOnly}
                  value={draft.idValue}
                  placeholder={intl.formatMessage({
                    id: "settings.modelProvider.modelId",
                  })}
                  onChange={(event) => {
                    onDraftChange({ idValue: event.target.value });
                  }}
                  onBlur={onModelIdBlur}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
                {mode === "add" && fetchAvailableModels ? (
                  <div className="mt-2 space-y-2" data-model-fetch-available="true">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={fetchingModels}
                        onClick={() => {
                          void handleFetchAvailableModels();
                        }}
                      >
                        {fetchingModels ? (
                          <Loader2Icon data-icon="inline-start" aria-hidden="true" className="size-4 animate-spin" />
                        ) : null}
                        {intl.formatMessage({ id: "settings.modelProvider.fetchModels.action" })}
                      </Button>
                      {fetchState.phase === "ready" && fetchState.models.length > 0 ? (
                        <Input
                          {...TECHNICAL_INPUT_ATTRIBUTES}
                          type="text"
                          size="sm"
                          className="max-w-56"
                          value={fetchFilter}
                          placeholder={intl.formatMessage({
                            id: "settings.modelProvider.fetchModels.filter",
                          })}
                          onChange={(event) => setFetchFilter(event.target.value)}
                        />
                      ) : null}
                    </div>
                    {fetchState.phase === "loading" ? (
                      <p className="text-ui-sm text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.modelProvider.fetchModels.loading" })}
                      </p>
                    ) : null}
                    {fetchState.phase === "error" ? (
                      <p className="text-ui-sm text-destructive">{fetchState.message}</p>
                    ) : null}
                    {fetchState.phase === "ready" && fetchState.models.length === 0 ? (
                      <p className="text-ui-sm text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.modelProvider.fetchModels.empty" })}
                      </p>
                    ) : null}
                    {fetchState.phase === "ready" && fetchedModels.length > 0 ? (
                      <div
                        className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-input-border bg-input p-1"
                        data-model-fetch-options="true"
                      >
                        {fetchedModels.map((model) => (
                          <button
                            key={model}
                            type="button"
                            className={cn(
                              "block w-full truncate rounded-md px-2 py-1 text-left font-mono text-ui-sm hover:bg-accent",
                              draft.idValue === model && "bg-accent",
                            )}
                            onClick={() => {
                              onDraftChange({ idValue: model });
                            }}
                          >
                            {model}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelSettingsGroup group="tokens">
            <div className="space-y-3">
              <div>
                <div className="mb-1 block text-ui-base text-foreground-subtle">
                  <ModelConfigInputLabel field="contextWindow" htmlFor={contextWindowInputId} />
                </div>
                <Input
                  {...TECHNICAL_INPUT_ATTRIBUTES}
                  id={contextWindowInputId}
                  type="text"
                  autoFocus={shouldFocusContextWindowInput}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  size="lg"
                  value={draft.contextWindowValue}
                  data-personal-override={overridden(
                    "contextWindowValue",
                    personalConfig?.properties?.contextWindow !== undefined,
                  )}
                  className={modelEditorControlStyle(
                    overridden(
                      "contextWindowValue",
                      personalConfig?.properties?.contextWindow !== undefined,
                    ),
                  )}
                  placeholder={
                    draft.useRecommendedConfigValue === false ||
                    inheritedConfig?.properties?.contextWindow === undefined
                      ? undefined
                      : String(inheritedConfig.properties.contextWindow)
                  }
                  onChange={(event) => {
                    onDraftChange({ contextWindowValue: event.target.value });
                  }}
                  onFocus={selectFocusedInputText}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelSettingsGroup group="tokens">
            <div className="space-y-3">
              <div data-model-max-output="true">
                <div className="mb-1 flex items-center gap-2">
                  <div className="text-ui-base text-foreground-subtle">
                    <ModelConfigInputLabel field="maxOutputTokens" htmlFor={maxOutputInputId} />
                  </div>
                  {addModelConfigResolutionPending ? (
                    <span
                      className="inline-flex shrink-0 items-center text-foreground-subtlest"
                      role="status"
                    >
                      <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
                      <span className="sr-only">
                        {intl.formatMessage({ id: "common.loading" })}
                      </span>
                    </span>
                  ) : null}
                </div>
                <Input
                  {...TECHNICAL_INPUT_ATTRIBUTES}
                  id={maxOutputInputId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  size="lg"
                  value={draft.maxOutputTokensValue}
                  data-personal-override={overridden(
                    "maxOutputTokensValue",
                    personalConfig?.optionSpecs?.maxOutputTokens?.max !== undefined,
                  )}
                  className={modelEditorControlStyle(
                    overridden(
                      "maxOutputTokensValue",
                      personalConfig?.optionSpecs?.maxOutputTokens?.max !== undefined,
                    ),
                  )}
                  placeholder={
                    draft.useRecommendedConfigValue === false ||
                    inheritedConfig?.optionSpecs?.maxOutputTokens?.max === undefined
                      ? undefined
                      : String(inheritedConfig.optionSpecs.maxOutputTokens.max)
                  }
                  disabled={maxOutputTokensInputDisabled}
                  aria-label={intl.formatMessage({
                    id: "settings.modelProvider.maxOutputTokens",
                  })}
                  aria-busy={addModelConfigResolutionPending}
                  onChange={(event) => onDraftChange({ maxOutputTokensValue: event.target.value })}
                  onFocus={selectFocusedInputText}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={handleTechnicalInputKeyDown}
                />
              </div>
            </div>
          </ModelSettingsGroup>
          <ModelEditorAdvanced
            open={open}
            errorField={draftErrorField}
            validationAttempt={validationAttempt}
          >
            <ModelSettingsGroup group="modalities">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 block text-ui-base text-foreground-subtle">
                    {intl.formatMessage({ id: "settings.modelProvider.inputModalities" })}
                    <ModelConfigHelp field="inputModalities" />
                  </div>
                  <ProviderModelInputModalityOptions
                    value={draft.inputFormatValue}
                    onChange={(inputFormatValue) => onDraftChange({ inputFormatValue })}
                    personalValue={personalConfig?.properties?.inputFormat}
                    overrideFields={activeOverrides}
                  />
                </div>
              </div>
            </ModelSettingsGroup>
            <ModelSettingsGroup group="capabilities">
              <div>
                <div
                  className="mb-1 block text-ui-base text-foreground-subtle"
                  data-model-capabilities-label="true"
                >
                  {intl.formatMessage({ id: "settings.modelProvider.capabilities" })}
                  <ModelConfigHelp field="capabilities" />
                </div>
                <div className="flex flex-wrap gap-2" data-model-capabilities-options="true">
                  {(
                    [
                      "supportsJsonSchemaOutput",
                      "supportsNativeWebSearch",
                      "supportsMidConversationSystem",
                    ] as const
                  ).map((property) => {
                    const field = `${property}Value` as const;
                    return (
                      <BooleanModelOption
                        key={property}
                        label={intl.formatMessage({ id: `settings.modelProvider.${property}` })}
                        selected={draft[field] ?? false}
                        onToggle={() => onDraftChange({ [field]: !(draft[field] ?? false) })}
                        overridden={overridden(
                          field,
                          personalConfig?.properties?.[property] !== undefined,
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            </ModelSettingsGroup>
            <ProviderModelReasoningSettings
              draft={draft}
              personalConfig={personalConfig}
              overrideFields={activeOverrides}
              inheritedConfig={inheritedConfig}
              onDraftChange={onDraftChange}
            />
          </ModelEditorAdvanced>
        </div>
        <ModelConfigDraftFeedback error={draftErrorMessage} matched={modelDefaultsLoaded} />
        <ProviderModelMetadataDialogActions
          leadingAction={<ModelConfigRestoreButton disabled={saving} onRestore={onRestore} />}
          saveLabel={intl.formatMessage({ id: "common.save" })}
          cancelLabel={intl.formatMessage({ id: "common.cancel" })}
          saving={saving}
          onSave={() => void commit()}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
