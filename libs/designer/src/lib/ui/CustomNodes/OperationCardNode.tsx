import constants from '../../common/constants';
import { getMonitoringError } from '../../common/utilities/error';
import { getExpressionTokenSections, getOutputTokenSections, type AppDispatch, type RootState } from '../../core';
import { copyOperation } from '../../core/actions/bjsworkflow/copypaste';
import { moveOperation } from '../../core/actions/bjsworkflow/move';
import {
  useHostOptions,
  useMonitoringView,
  useNodeSelectAdditionalCallback,
  useReadOnly,
  useSuppressDefaultNodeSelectFunctionality,
} from '../../core/state/designerOptions/designerOptionsSelectors';
import { setNodeContextMenuData, setShowDeleteModalNodeId } from '../../core/state/designerView/designerViewSlice';
import { ErrorLevel } from '../../core/state/operation/operationMetadataSlice';
import {
  useOperationErrorInfo,
  useSecureInputsOutputs,
  useParameterStaticResult,
  useParameterValidationErrors,
  useTokenDependencies,
  useOperationVisuals,
  useDependencies,
} from '../../core/state/operation/operationSelector';
import { useIsNodePinnedToOperationPanel, useIsNodeSelectedInOperationPanel } from '../../core/state/panel/panelSelectors';
import { changePanelNode, setSelectedNodeId } from '../../core/state/panel/panelSlice';
import {
  useAllOperations,
  useConnectorName,
  useIsConnectionRequired,
  useNodeConnectionName,
  useOperationInfo,
  useOperationQuery,
} from '../../core/state/selectors/actionMetadataSelector';
import { useSettingValidationErrors } from '../../core/state/setting/settingSelector';
import {
  useNodeDescription,
  useNodeDisplayName,
  useNodeMetadata,
  useNodesMetadata,
  useRunData,
  useParentRunIndex,
  useRunInstance,
  useShouldNodeFocus,
  useParentRunId,
  useIsLeafNode,
  useReplacedIds,
} from '../../core/state/workflow/workflowSelectors';
import { setRepetitionRunData } from '../../core/state/workflow/workflowSlice';
import { getRepetitionName } from '../common/LoopsPager/helper';
import { DropZone } from '../connections/dropzone';
import { MessageBarType } from '@fluentui/react';
import type { ParameterInfo, ValueSegment } from '@microsoft/logic-apps-shared';
import {
  equals,
  getPropertyValue,
  getRecordEntry,
  isNullOrUndefined,
  isRecordNotEmpty,
  replaceWhiteSpaceWithUnderscore,
  RunService,
  TokenType,
  useNodeIndex,
} from '@microsoft/logic-apps-shared';
import type { ChangeState, OutputToken, TokenPickerMode } from '@microsoft/designer-ui';
import { Card, DynamicCallStatus, isCustomCode, TokenPicker, TokenPickerButtonLocation } from '@microsoft/designer-ui';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useDrag } from 'react-dnd';
import { useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useHotkeys } from 'react-hotkeys-hook';
import { CopyTooltip } from '../common/DesignerContextualMenu/CopyTooltip';
import type { Settings } from '../settings/settingsection';
import { SettingsSection } from '../settings/settingsection';
import {
  getTypeForTokenFiltering,
  loadDynamicTreeItemsForParameter,
  loadDynamicValuesForParameter,
  loadParameterValueFromString,
  parameterValueToString,
  remapEditorViewModelWithNewIds,
  remapValueSegmentsWithNewIds,
  shouldUseParameterInGroup,
  updateParameterAndDependencies,
} from '../../core/utils/parameters/helper';
import { getConnectionReference } from '../../core/utils/connectors/connections';
import { getEditorAndOptions } from '../panel/nodeDetailsPanel/tabs/parametersTab';
import { createValueSegmentFromToken } from '../../core/utils/tokens';
import { updateVariableInfo } from '../../core/state/tokens/tokensSlice';
import { addOrUpdateCustomCode } from '../../core/state/customcode/customcodeSlice';

const DefaultNode = ({ targetPosition = Position.Top, sourcePosition = Position.Bottom, id }: NodeProps) => {
  const readOnly = useReadOnly();
  const isMonitoringView = useMonitoringView();
  const intl = useIntl();

  const dispatch = useDispatch<AppDispatch>();
  const operationsInfo = useAllOperations();
  const errorInfo = useOperationErrorInfo(id);
  const metadata = useNodeMetadata(id);
  const operationInfo = useOperationInfo(id);
  const connectorName = useConnectorName(operationInfo);
  const isTrigger = useMemo(() => metadata?.graphId === 'root' && metadata?.isRoot, [metadata]);
  const parentRunIndex = useParentRunIndex(id);
  const runInstance = useRunInstance();
  const runData = useRunData(id);
  const parentRunId = useParentRunId(id);
  const parentRunData = useRunData(parentRunId ?? '');
  const nodesMetaData = useNodesMetadata();
  const repetitionName = getRepetitionName(parentRunIndex, id, nodesMetaData, operationsInfo);
  const isSecureInputsOutputs = useSecureInputsOutputs(id);
  const { status: statusRun, error: errorRun, code: codeRun } = runData ?? {};

  const suppressDefaultNodeSelect = useSuppressDefaultNodeSelectFunctionality();
  const nodeSelectCallbackOverride = useNodeSelectAdditionalCallback();

  const nodeId = id;
  const selectedNodeId = id;
  const nodeType = useSelector((state: RootState) => state.operations.operationInfo[selectedNodeId]?.type);
  const rootState = useSelector((state: RootState) => state);
  const displayNameResult = useConnectorName(operationInfo);
  const nodeDependencies = useDependencies(nodeId);
  const nodeInputs = useMemo(
    () => rootState.operations.inputParameters[id] ?? { parameterGroups: {} },
    [id, rootState.operations.inputParameters]
  );
  const { variables, upstreamNodeIds, operationDefinition, connectionReference, idReplacements, workflowParameters } = useSelector(
    (state: RootState) => {
      return {
        upstreamNodeIds: getRecordEntry(state.tokens.outputTokens, nodeId)?.upstreamNodeIds,
        variables: state.tokens.variables,
        operationDefinition: getRecordEntry(state.workflow.newlyAddedOperations, nodeId)
          ? undefined
          : getRecordEntry(state.workflow.operations, nodeId),
        connectionReference: getConnectionReference(state.connections, nodeId),
        idReplacements: state.workflow.idReplacements,
        workflowParameters: state.workflowParameters.definitions,
      };
    }
  );
  const { tokenState, workflowParametersState } = useSelector((state: RootState) => ({
    tokenState: state.tokens,
    workflowParametersState: state.workflowParameters,
  }));
  const replacedIds = useReplacedIds();
  const tokenGroup = getOutputTokenSections(selectedNodeId, nodeType, tokenState, workflowParametersState, replacedIds);
  const { hideUTFExpressions } = useHostOptions();
  const expressionGroup = getExpressionTokenSections(hideUTFExpressions);
  const nodeTitle = replaceWhiteSpaceWithUnderscore(useNodeDisplayName(id));
  const [showParameters, setShowParameters] = useState(false);

  const getRunRepetition = () => {
    if (parentRunData?.status === constants.FLOW_STATUS.SKIPPED) {
      return {
        properties: {
          status: constants.FLOW_STATUS.SKIPPED,
          inputsLink: null,
          outputsLink: null,
          startTime: null,
          endTime: null,
          trackingId: null,
          correlation: null,
        },
      };
    }
    return RunService().getRepetition({ nodeId: id, runId: runInstance?.id }, repetitionName);
  };

  const { isFetching: isRepetitionLoading, data: repetitionData } = useQuery<any>(
    ['runInstance', { nodeId: id, runId: runInstance?.id, repetitionName, parentStatus: parentRunData?.status, parentRunIndex }],
    getRunRepetition,
    {
      refetchOnWindowFocus: false,
      enabled: isMonitoringView && parentRunIndex !== undefined,
    }
  );

  useEffect(() => {
    if (!isNullOrUndefined(repetitionData)) {
      dispatch(setRepetitionRunData({ nodeId: id, runData: repetitionData.properties as any }));
    }
  }, [dispatch, id, repetitionData, runInstance?.id]);

  const dependencies = useTokenDependencies(id);

  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: 'BOX',
      end: (item, monitor) => {
        const dropResult = monitor.getDropResult<{
          graphId: string;
          parentId: string;
          childId: string;
        }>();
        if (item && dropResult) {
          dispatch(
            moveOperation({
              nodeId: id,
              oldGraphId: metadata?.graphId ?? 'root',
              newGraphId: dropResult.graphId,
              relationshipIds: dropResult,
            })
          );
        }
      },
      item: {
        id: id,
        dependencies,
        graphId: metadata?.graphId,
      },
      canDrag: !readOnly && !isTrigger,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [readOnly, metadata, dependencies]
  );

  const selected = useIsNodeSelectedInOperationPanel(id);
  const isPinned = useIsNodePinnedToOperationPanel(id);
  const nodeComment = useNodeDescription(id);
  const connectionResult = useNodeConnectionName(id);
  const isConnectionRequired = useIsConnectionRequired(operationInfo);
  const isLeaf = useIsLeafNode(id);
  const label = useNodeDisplayName(id);

  const showLeafComponents = useMemo(() => !readOnly && isLeaf, [readOnly, isLeaf]);

  const { brandColor, iconUri } = useOperationVisuals(id);

  const comment = useMemo(
    () =>
      nodeComment
        ? {
            brandColor,
            comment: nodeComment,
            isDismissed: false,
            isEditing: false,
          }
        : undefined,
    [brandColor, nodeComment]
  );

  const handleNodeSelection = useCallback(() => {
    if (nodeSelectCallbackOverride) {
      nodeSelectCallbackOverride(id);
    }
    if (suppressDefaultNodeSelect) {
      dispatch(setSelectedNodeId(id));
    } else {
      dispatch(changePanelNode(id));
    }
  }, [dispatch, id, nodeSelectCallbackOverride, suppressDefaultNodeSelect]);

  const nodeClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      handleNodeSelection();
      event.stopPropagation();
    },
    [handleNodeSelection]
  );

  const toggleShowParameters = () => {
    setShowParameters(!showParameters);
  };

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dispatch(
        setNodeContextMenuData({
          nodeId: id,
          location: {
            x: e.clientX,
            y: e.clientY,
          },
        })
      );
    },
    [dispatch, id]
  );

  const deleteClick = useCallback(() => {
    dispatch(setShowDeleteModalNodeId(id));
  }, [dispatch, id]);

  const [showCopyCallout, setShowCopyCallout] = useState(false);
  const copyClick = useCallback(() => {
    setShowCopyCallout(true);
    dispatch(copyOperation({ nodeId: id }));
    setCopyCalloutTimeout(setTimeout(() => setShowCopyCallout(false), 3000));
  }, [dispatch, id]);

  const [copyCalloutTimeout, setCopyCalloutTimeout] = useState<NodeJS.Timeout>();
  const clearCopyTooltip = useCallback(() => {
    copyCalloutTimeout && clearTimeout(copyCalloutTimeout);
    setShowCopyCallout(false);
  }, [copyCalloutTimeout]);

  const ref = useHotkeys(['meta+c', 'ctrl+c'], copyClick, { preventDefault: true });

  const { isFetching: isOperationQueryLoading, isError: isOperationQueryError } = useOperationQuery(id);

  const isLoading = useMemo(() => isRepetitionLoading || isOperationQueryLoading, [isRepetitionLoading, isOperationQueryLoading]);

  const opManifestErrorText = intl.formatMessage({
    defaultMessage: 'Error fetching manifest',
    id: 'HmcHoE',
    description: 'Error message when manifest fails to load',
  });

  const settingValidationErrors = useSettingValidationErrors(id);
  const settingValidationErrorText = intl.formatMessage({
    defaultMessage: 'Invalid settings',
    id: 'Jil/Wa',
    description: 'Text to explain that there are invalid settings for this node',
  });

  const parameterValidationErrors = useParameterValidationErrors(id);
  const parameterValidationErrorText = intl.formatMessage({
    defaultMessage: 'Invalid parameters',
    id: 'Tmr/9e',
    description: 'Text to explain that there are invalid parameters for this node',
  });

  const { errorMessage, errorLevel } = useMemo(() => {
    if (errorInfo && errorInfo.level !== ErrorLevel.DynamicOutputs) {
      const { message, level } = errorInfo;
      return {
        errorMessage: message,
        errorLevel:
          level !== ErrorLevel.Default && level !== ErrorLevel.DynamicInputs ? MessageBarType.error : MessageBarType.severeWarning,
      };
    }

    if (isOperationQueryError) {
      return { errorMessage: opManifestErrorText, errorLevel: MessageBarType.error };
    }

    if (settingValidationErrors?.length > 0) {
      return { errorMessage: settingValidationErrorText, errorLevel: MessageBarType.severeWarning };
    }

    if (parameterValidationErrors?.length > 0) {
      return { errorMessage: parameterValidationErrorText, errorLevel: MessageBarType.severeWarning };
    }

    if (isMonitoringView) {
      return getMonitoringError(errorRun, statusRun, codeRun);
    }

    return { errorMessage: undefined, errorLevel: undefined };
  }, [
    errorInfo,
    isOperationQueryError,
    settingValidationErrors?.length,
    parameterValidationErrors?.length,
    isMonitoringView,
    opManifestErrorText,
    settingValidationErrorText,
    parameterValidationErrorText,
    errorRun,
    statusRun,
    codeRun,
  ]);

  const shouldFocus = useShouldNodeFocus(id);
  const staticResults = useParameterStaticResult(id);

  const nodeIndex = useNodeIndex(id);

  const inputs = useSelector((state: RootState) => state.operations.inputParameters[id]);
  const group = inputs?.parameterGroups['default'];

  const getValueSegmentFromToken = useCallback(
    async (
      parameterId: string,
      token: OutputToken,
      addImplicitForeachIfNeeded: boolean,
      addLatestActionName: boolean
    ): Promise<ValueSegment> => {
      return createValueSegmentFromToken(nodeId, parameterId, token, addImplicitForeachIfNeeded, addLatestActionName, rootState, dispatch);
    },
    [dispatch, nodeId, rootState]
  );

  const getPickerCallbacks = (parameter: ParameterInfo) => ({
    getFileSourceName: (): string => {
      return displayNameResult.result;
    },
    getDisplayValueFromSelectedItem: (selectedItem: any): string => {
      const dependency = nodeDependencies.inputs[parameter.parameterKey];
      return getPropertyValue(selectedItem, dependency.filePickerInfo?.fullTitlePath ?? '');
    },
    getValueFromSelectedItem: (selectedItem: any): string => {
      const dependency = nodeDependencies.inputs[parameter.parameterKey];
      return getPropertyValue(selectedItem, dependency.filePickerInfo?.valuePath ?? '');
    },
    onFolderNavigation: (selectedItem: any | undefined): void => {
      loadDynamicTreeItemsForParameter(
        nodeId,
        group.id,
        parameter.id,
        selectedItem,
        operationInfo,
        connectionReference,
        nodeInputs,
        nodeDependencies,
        true /* showErrorWhenNotReady */,
        dispatch,
        idReplacements,
        workflowParameters
      );
    },
  });

  const getTokenPicker = (
    parameterId: string,
    editorId: string,
    labelId: string,
    tokenPickerMode?: TokenPickerMode,
    editorType?: string,
    isCodeEditor?: boolean,
    tokenClickedCallback?: (token: ValueSegment) => void
  ): JSX.Element => {
    const parameterType =
      editorType ?? (nodeInputs.parameterGroups[group.id].parameters.find((param) => param.id === parameterId) ?? {})?.type;
    const supportedTypes: string[] = getPropertyValue(constants.TOKENS, getTypeForTokenFiltering(parameterType));

    const filteredTokenGroup = tokenGroup.map((group) => ({
      ...group,
      tokens: group.tokens.filter((token: OutputToken) => {
        if (isCodeEditor) {
          return !(
            token.outputInfo.type === TokenType.VARIABLE ||
            token.outputInfo.type === TokenType.PARAMETER ||
            token.outputInfo.arrayDetails ||
            token.key === constants.UNTIL_CURRENT_ITERATION_INDEX_KEY ||
            token.key === constants.FOREACH_CURRENT_ITEM_KEY
          );
        }
        return supportedTypes.some((supportedType) => {
          return !Array.isArray(token.type) && equals(supportedType, token.type);
        });
      }),
    }));

    return (
      <TokenPicker
        editorId={editorId}
        labelId={labelId}
        tokenGroup={tokenGroup}
        filteredTokenGroup={filteredTokenGroup}
        expressionGroup={expressionGroup}
        hideUTFExpressions={hideUTFExpressions}
        initialMode={tokenPickerMode}
        getValueSegmentFromToken={(token: OutputToken, addImplicitForeach: boolean) =>
          getValueSegmentFromToken(parameterId, token, addImplicitForeach, !!isCodeEditor)
        }
        tokenClickedCallback={tokenClickedCallback}
      />
    );
  };

  const onValueChange = useCallback(
    (id: string, newState: ChangeState) => {
      // Skip for nodes without group.id. (ex. Default node)
      if (!group?.id) {
        return;
      }

      const { value, viewModel } = newState;
      const parameter = nodeInputs.parameterGroups[group.id].parameters.find((param: any) => param.id === id);

      const propertiesToUpdate = {
        value,
        preservedValue: undefined,
      } as Partial<ParameterInfo>;

      if (viewModel !== undefined) {
        propertiesToUpdate.editorViewModel = viewModel;
      }

      // TODO: This should never be added, since the update is taken care by dynamic parameter update.
      if (getRecordEntry(variables, nodeId)) {
        if (parameter?.parameterKey === 'inputs.$.name') {
          dispatch(updateVariableInfo({ id: nodeId, name: value[0]?.value }));
        } else if (parameter?.parameterKey === 'inputs.$.type') {
          dispatch(updateVariableInfo({ id: nodeId, type: value[0]?.value }));
        }
      }

      if (isCustomCode(parameter?.editor, parameter?.editorOptions?.language)) {
        const { fileData, fileExtension, fileName } = viewModel.customCodeData;
        dispatch(addOrUpdateCustomCode({ nodeId, fileData, fileExtension, fileName }));
      }

      dispatch(
        updateParameterAndDependencies({
          nodeId,
          groupId: group?.id,
          parameterId: id,
          properties: propertiesToUpdate,
          isTrigger: !!isTrigger,
          operationInfo,
          connectionReference,
          nodeInputs,
          dependencies: nodeDependencies,
          operationDefinition,
        })
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeId, group?.id, isTrigger, operationInfo, connectionReference, nodeInputs, dependencies, variables, dispatch, operationDefinition]
  );

  const onComboboxMenuOpen = (parameter: ParameterInfo): void => {
    if (parameter.dynamicData?.status === DynamicCallStatus.FAILED || parameter.dynamicData?.status === DynamicCallStatus.NOTSTARTED) {
      loadDynamicValuesForParameter(
        nodeId,
        group.id,
        parameter.id,
        operationInfo,
        connectionReference,
        nodeInputs,
        nodeDependencies,
        true /* showErrorWhenNotReady */,
        dispatch,
        idReplacements,
        workflowParameters
      );
    }
  };

  const settings: Settings[] = group?.parameters
    .filter((x) => !x.hideInUI && shouldUseParameterInGroup(x, group.parameters))
    .map((param) => {
      const { id, label, value, required, showTokens, placeholder, editorViewModel, dynamicData, conditionalVisibility, validationErrors } =
        param;
      const remappedEditorViewModel = isRecordNotEmpty(idReplacements)
        ? remapEditorViewModelWithNewIds(editorViewModel, idReplacements)
        : editorViewModel;
      const paramSubset = {
        id,
        label,
        required,
        showTokens,
        placeholder,
        editorViewModel: remappedEditorViewModel,
        conditionalVisibility,
      };
      const { editor, editorOptions } = getEditorAndOptions(operationInfo, param, upstreamNodeIds ?? [], variables);

      const { value: remappedValues } = isRecordNotEmpty(idReplacements) ? remapValueSegmentsWithNewIds(value, idReplacements) : { value };
      const isCodeEditor = editor?.toLowerCase() === constants.EDITOR.CODE;

      return {
        settingType: 'SettingTokenField',
        settingProp: {
          ...paramSubset,
          readOnly,
          value: remappedValues,
          editor,
          editorOptions,
          tokenEditor: true,
          isLoading: dynamicData?.status === DynamicCallStatus.STARTED,
          errorDetails: dynamicData?.error ? { message: dynamicData.error.message } : undefined,
          validationErrors,
          tokenMapping: {},
          nodeTitle,
          loadParameterValueFromString: (value: string) => loadParameterValueFromString(value),
          onValueChange: (newState: ChangeState) => onValueChange(id, newState),
          onComboboxMenuOpen: () => onComboboxMenuOpen(param),
          pickerCallbacks: getPickerCallbacks(param),
          tokenpickerButtonProps: {
            location: TokenPickerButtonLocation.Left,
          },
          suppressCastingForSerialize: false,
          onCastParameter: (value: ValueSegment[], type?: string, format?: string, suppressCasting?: boolean) =>
            parameterValueToString(
              {
                value,
                type: type ?? 'string',
                info: { format },
                suppressCasting,
              } as ParameterInfo,
              false,
              idReplacements
            ) ?? '',
          getTokenPicker: (
            editorId: string,
            labelId: string,
            tokenPickerMode?: TokenPickerMode,
            editorType?: string,
            tokenClickedCallback?: (token: ValueSegment) => void
          ) => getTokenPicker(id, editorId, labelId, tokenPickerMode, editorType, isCodeEditor, tokenClickedCallback),
        },
      };
    });

  const parameterSection = (
    <div style={{ margin: '16px' }}>
      <SettingsSection nodeId={id} settings={settings} expanded={true} showHeading={false} />
    </div>
  );
  return (
    <>
      <div className="nopan" ref={ref as any}>
        <Handle className="node-handle top" type="target" position={targetPosition} isConnectable={false} />
        <Card
          title={label}
          icon={iconUri}
          draggable={!readOnly && !isTrigger}
          brandColor={brandColor}
          id={id}
          connectionRequired={isConnectionRequired}
          connectionDisplayName={connectionResult.isLoading ? '...' : connectionResult.result}
          connectorName={connectorName?.result}
          commentBox={comment}
          drag={drag}
          dragPreview={dragPreview}
          errorMessage={errorMessage}
          errorLevel={errorLevel}
          isDragging={isDragging}
          isLoading={isLoading}
          isMonitoringView={isMonitoringView}
          runData={runData}
          readOnly={readOnly}
          onClick={toggleShowParameters}
          onContextMenu={onContextMenu}
          onDeleteClick={deleteClick}
          onCopyClick={copyClick}
          selectionMode={selected ? 'selected' : isPinned ? 'pinned' : false}
          setFocus={shouldFocus}
          staticResultsEnabled={!!staticResults}
          isSecureInputsOutputs={isSecureInputsOutputs}
          nodeIndex={nodeIndex}
          showParameters={settings !== undefined && showParameters}
          parameters={parameterSection}
          onExpandIconClick={nodeClick}
        />
        {/* {settings && <SettingsSection nodeId={id} settings={settings} expanded={true} showHeading={false} />} */}
        {showCopyCallout ? <CopyTooltip targetRef={ref} hideTooltip={clearCopyTooltip} /> : null}
        <Handle className="node-handle bottom" type="source" position={sourcePosition} isConnectable={false} />
      </div>
      {showLeafComponents ? (
        <div className={'edge-drop-zone-container'}>
          <DropZone graphId={metadata?.graphId ?? ''} parentId={id} isLeaf={isLeaf} tabIndex={nodeIndex} />
        </div>
      ) : null}
    </>
  );
};

DefaultNode.displayName = 'DefaultNode';

export default memo(DefaultNode);
