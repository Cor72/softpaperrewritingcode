import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import AccountDialog from './account/AccountDialog.jsx'
import { accountStore } from './account/store.js'
import { createQuestionOperation } from './account/usageAccess.js'
import { SceneTitle } from './components/SceneTitle.jsx'
import { SchoolProcessParameters } from './components/SchoolProcessParameters.jsx'
import { ConstructionScopeNotice, formatConstructionClock, sceneConstructionProcess, selectedPhaseScopeLabel } from './components/ConstructionScopeNotice.jsx'
import { AnswerPresentation } from './components/AnswerPresentation.jsx'
import { ReferenceSolutionPresentation, ReferenceSolutionReview } from './components/ReferenceSolution.jsx'
import { PhysicsText } from './components/PhysicsText.jsx'
import { AiTaskStatus } from './components/AiTaskStatus.jsx'
import { AiConstructionMark } from './components/AiConstructionMark.jsx'
import { agentThinkingStep, aiThinkingSteps, AiThinkingTrace } from './components/AiThinking.jsx'
import { ProblemReviewSummary } from './components/ProblemReviewSummary.jsx'
import { AssemblyLibrary, AssemblyParameters } from './components/AssemblyLibrary.jsx'
import { BodyAppearance, BodyToolIcon } from './components/BodyAppearance.jsx'
import { WorkspacePanel } from './components/WorkspacePanel.jsx'
import { PaletteRail } from './components/PaletteRail.jsx'
import { SceneLibraryDialog } from './components/SceneLibraryDialog.jsx'
import BoardCanvas from './components/BoardCanvas.jsx'
import { PlaybackControls } from './components/PlaybackControls.jsx'
import { ComponentPalette } from './components/ComponentPalette.jsx'
import { BottomDock } from './components/BottomDock.jsx'
import { RuntimePhysicsInspector } from './components/RuntimePhysicsInspector.jsx'
import { SubquestionScenarioPanel } from './components/SubquestionScenarioPanel.jsx'
import { AiBuilder } from './components/AiBuilder.jsx'
import { ConstructCore } from './components/ConstructCore.jsx'
import { SceneCanvasThumbnail } from './components/SceneCanvasThumbnail.jsx'
import { ConfirmationDialog, IconButton } from './components/ui.jsx'
import { AlertTriangle, UserRound, BookOpen, Check, ChevronDown, ChevronUp, Download, FileImage, FolderOpen, Grid2X2, Hand, Moon, MousePointer2, MoreHorizontal, Pause, Plus, Play, Redo2, RotateCcw, Save, Sun, Undo2, Upload, X, Zap } from 'lucide-react'
// 物理模型层,取材model.js
import { DEFAULT_PIXELS_PER_METER, PRESETS, addComponentForTool, bodyAttachSnapPreview, beginParameterExperiment, buildSceneFromEvidence, componentsInSelectionRect, attachSnapPreview, contactMaterialBetween, createScene, convertToSandbox, springStoredEnergy, materializeScene, normalizeScene, paperAnnotations, presetScene, removeComponent, resizeComponent, supportSnapPreview, settleEditorScene, touchScene, translateComponent, translateComponents, updateComponent, updateContactMaterial, updateConstraintAttachment, updateConstraintAttachmentMode, updateRopeLength, wedgeSurfaceSegment } from './model.js'
import { arcVisualGeometry, bodyVisualPose, cartWheelVisualGeometry, compoundVisualBodies, constraintVisibleAtTime, conveyorBeltMarkers, fixedAnchorVisualGeometry, grooveVisualGeometry, inclineVisualOutline, openBoxVisualGeometry, mountedSpringView, liveBodyDisplay, nearestContactAngle, pointGlyphOffsets, supportHatchSegments, supportVisualSurface, visibleSupportGeometry, polar, arcSweepRadians, normalizedDegrees } from './visualGeometry.js'
import { springEnergyData } from './physics/springEnergyEvidence.js'
import { applySubquestionScenario, updateSubquestionDelta } from './physics/subquestionScenarios.js'
import { normalizeParameterDraft, parameterStepDisabled, stepParameterValue, snapParameterAngle, formatParameterValue, formatNumericValue } from './parameterInput.js'
import { trackInclination, trackSlope, editTrackInclination, formatAngle } from './trackAnglePresentation.js'
import { objectObservations, globalObservation } from './observationPresentation.js'
//这一坨是AI出题/搭建
import { listLocalBuilds } from './ai/constructionJobClient.js'
import { canRecoverLocalBuild, recoverConstructionResult } from './ai/constructionRecovery.js'
import { loadSourceImage, restoredImageMeta, saveSourceImage, sha256OfBlob } from './ai/sourceImageStore.js'
import { prepareProblemImage, requestProblemUploadPolicy } from './ai/problemImage.js'
import { mergeImageMeta } from '../shared/sourceImageProvenance.js'
import { aiSceneViewportIdentity, fitSceneBoundsToViewport } from './aiViewport.js'
import { checkBuildReadiness, scenePhysicsKey, sceneRunReadiness } from './ai/problemAnalysis.js'
import { createProblemReviewDraft, rebuildClosedBankDraft, recoverKeptBankDraft, ANSWER_MEDIA_NOTICE } from './ai/problemReviewDraft.js'
import { prepareCanvasDelivery, rebuildRetainedProblem, rebindScenarioData } from './ai/problemCanvasDelivery.js'
import { problemFlow, problemResultView, hasBankContent, hasProblemTextEdit, captureReferenceReview, referenceReviewedScene, needBuildConstraints, rebuildProblemFromKeptData } from './ai/problemFlow.js'
import { hasRealAnswer } from '../shared/answerPresentation.js'
import { insertAssembly, updateAssembly, dissolveAssembly } from './componentAssemblies.js'
import { assemblyForMember, assemblyRecipe, expandAssemblySelection } from './assemblyCatalog.js'
import { selectAssemblyItem, editAssemblyMembers } from './assemblyEditing.js'
import { runBuildLoop } from './agent/harness.js'
import { applySvgDrawingStroke, captureSvgDrawingStroke, restoreSvgDrawingStroke } from './drawingStroke.js'
import { usePhysicsRuntime, useRuntimeSnapshot, useRuntimeValue, selectRuntimeCompounds, selectRuntimeStarted, sameCompounds } from './usePhysicsRuntime.js'
import { commitHistory, isEditingTarget, isTextInput, hasSceneEdit, assemblyEditRequiresReset } from './editorHistory.js'
import { loadWorkspace, readSceneLibrary, saveDraft, saveSceneToStorage, deleteSceneFromStorage, sceneContentKey, sceneForStorage } from './sceneStorage.js'
import { prepareImportedScene } from './sceneValidation.js'
import { createPaletteMotion } from './paletteMotion.js'
import { editorSupportHandles, editorResizePoint, editorSnapPreviewGeometry, editorConstraintSnapshot, editorSelectionScene, EndpointHandle, AngleLabel, SurfaceHatching } from './editorHandles.js'
import { editorSnapDistance } from './editorPlacement.js'
import { trapDialogFocus } from './dialogFocus.js'
import { useAnchoredDetailsMenu } from './anchoredMenu.js'

const DRAWING_COMPONENT_SELECTOR = '.scene-constraints > *, .scene-supports > *, .scene-anchors > *, .scene-bodies > *'
const MAX_CONCURRENT_DRAWING_COMPONENTS =3
const DRAWING_ROW_TOLERANCE =48
const DRAWING_PEN_TIP_X =35
const DRAWING_PEN_TIP_Y = 9
const IMPORT_SIZE_LIMIT=5 * 1024 * 1024
const THEME_PREFERENCE_KEY = 'xingchi-vision-v3:theme'

// 单位毫秒
const DRAFT_SAVE_DELAY_MS=450
const TOAST_DURATION_MS=2200
const SAVE_FEEDBACK_MS=2400

// 调色板导轨
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

// const DEFAULT_THEME = readTheme()
// const DEFAULT_THEME_COLOR_MODE = DEFAULT_THEME?'dark':'light'
// 运动程序转沙盒态
const needsSandbox = (target) => target.components.some(item => item.motionProgram)

//读文件
const readFile = file => new Promise((resolve,reject) => {
  const reader = new FileReader();
  reader.onload =()=>resolve(String(reader.result||''));
  reader.onerror =()=>reject(reader.error);
  reader.readAsDataURL(file);
})

// const textHash=s=>s.length //偷懒版（）
const textHash = (text)=> {
  const value = String(text||'');
  let hash =0;
  for (let i=0;i<value.length; i++){
    hash=(hash*31 + value.charCodeAt(i))|0;
  }
  return hash;
}

const agentSourceKey = (analysis) => analysis?.sourceImageProvenance?.submittedSha256 ?? ''

// 主题偏好
function readTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_PREFERENCE_KEY)
    if (saved === 'dark') return true
    if (saved === 'light') return false
  } catch {
    //本机存储不可用
  }
  try { return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true } catch { return false }
}

//属性面板
const RUN_BLOCKING_CODES = ['PROCESS_PARAMETERS_REQUIRED', 'PROCESS_COMPONENT_BINDING_REQUIRED', 'MOTION_INVALID']

// 提示
const TOAST_NEED_RESET = '看看初始条件和复位'
const TOAST_NEED_UNLOCK = '编辑元件/解锁装置'
const TOAST_STORAGE_FULL = '存储空间满了'

export function App() {
  const accountState = useSyncExternalStore(accountStore.subscribe, accountStore.getSnapshot, accountStore.getSnapshot)
  const accountOpen = accountState.open
  const account = accountState.account

  //空场景
  const [initialWorkspace] = useState(() => {
    try {
      return loadWorkspace(window.localStorage)
    } catch {
      return {
        scene: createScene([]),
        savedKey: '',
        warning:'本机存储不可用，请及时导出备份。'
      }
    }
  })

  const [timeline, setTimeline] = useState(() => ({ past: [], present: initialWorkspace.scene, future: [] }))
  const scene = timeline.present

  const [selectedIds, setSelectedIds] = useState([])
  const [editingAssemblyId, setEditingAssemblyId] = useState(null)
  const selectedId = selectedIds[selectedIds.length - 1] ?? null

  const setSelectedId = (id) => {
    setSelectedIds(id ? [id] : [])
    setEditingAssemblyId(null)
  }

  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [pane, setPane] = useState('properties')
  const [panelOpen, setPanelOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const moreMenu = useAnchoredDetailsMenu()
  const toggleMoreMenu = (ev) => {
    ev.preventDefault()
    moreMenu.toggle()
  }

  const objectsOpen = panelOpen && pane === 'objects'

  const openPane = (next) => {
    setPane(next)
    setPanelOpen(true)
  }

  const setInspectorOpen = (value) => {
    if (value) {
      openPane('properties')
      return
    }
    setPanelOpen(false)
  }

  const setObjectsOpen = (value) => {
    const next = typeof value === 'function' ? value(objectsOpen) : value
    if (next) return openPane('objects')
    setPanelOpen(false)
  }

  const [paletteMode, setPaletteMode] = useState('components')
  const [aiDrawing, setAiDrawing] = useState(null)
  const [dark, setDark] = useState(readTheme)

  const [toast, setToast] = useState(() => {
    if (initialWorkspace.warning) return initialWorkspace.warning
    if (initialWorkspace.recovered) return '已恢复上次未保存内容'
    return ''
  })

  const [savedKey, setSavedKey] = useState(initialWorkspace.savedKey)
  const [draftStatus, setDraftStatus] = useState('pending')
  const [storageError, setStorageError] = useState(initialWorkspace.warning)

  const [library, setLibrary] = useState(() => {
    try {
      return readSceneLibrary(window.localStorage)
    } catch {
      return []
    }
  })
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => setSaveFailed(false), [scene.id])

  const [fitRequest, setFitRequest] = useState(0)
  const [pendingReplacement, setPendingReplacement] = useState(null)
  const [canvasTool, setCanvasTool] = useState('select')
  const importRef = useRef(null)

  const {
    snapshotRef, runtimeSnapshot, renderTime, runtimeFrame, positions, constraintPositions,
    running, run, runScene, pause, reset, resetScene, step, playbackRate, changePlaybackRate, runtimeError
  } = usePhysicsRuntime(scene)

  // 编辑器树不是20Hz！！！记得把时钟、播放态和属性面板tmd分开！
  // 只有成员真的变了才重渲染组合体
  const compounds = useRuntimeValue(runtimeSnapshot, selectRuntimeCompounds, sameCompounds)
  const started = useRuntimeValue(runtimeSnapshot, selectRuntimeStarted)

  const compositeBodies = useMemo(
    () => compoundVisualBodies(scene.components, positions, compounds, scene.annotations),
    [scene, positions, compounds]
  )
  //here
  const memberIdSet = useMemo(() => new Set(compositeBodies.flatMap(body => body.memberIds)), [compositeBodies])
  const listedObjects = useMemo(() => [
    ...scene.components.filter(item => !memberIdSet.has(item.id)),
    ...compositeBodies
  ], [scene.components, compositeBodies, memberIdSet])

  const contentKey = useMemo(() => sceneContentKey(scene), [scene])
  const dirty = contentKey !== savedKey
  const runReadiness = useMemo(() => sceneRunReadiness(scene), [scene])

  const requestRun = () => {
    if (running) {
      pause()
      return
    }
    if (!runReadiness.ready) {
      // ===学校流程实验
      if (scene.schoolProcess && RUN_BLOCKING_CODES.includes(runReadiness.code)) {
        setSelectedIds([])
        setEditingAssemblyId(null)
        setInspectorOpen(true)
        setToast(runReadiness.summary)
        return
      }
      // const saved = window.localStorage.getItem('saved')
      // if (saved) {
      //   const savedScene = JSON.parse(saved)
      //   if (savedScene.id === scene.id) {
      //     commit(savedScene)
      //     setFitRequest(value => value + 1)
      //     runScene(savedScene)
      //     return
      //   }
      // }
      const canRebuild = !scene.energyMotion
        && scene.source === 'ai-assist'
        && scene.problemAnalysis
        && !scene.problemAnalysis.constructionPlan
        && scene.reviewRecord?.source !== 'untrusted-import'
      if (canRebuild) {
        const rebuilt = rebuildRetainedProblem(scene)
        const hasMotion = rebuilt?.energyMotion || rebuilt?.nativeExperiment
        if (hasMotion && sceneRunReadiness(rebuilt).ready) {
          commit(rebuilt)
          setFitRequest(value => value + 1)
          runScene(rebuilt)
          return
        }
      }
      setToast(runReadiness.summary)
      if (runReadiness.componentId) {
        setSelectedId(runReadiness.componentId)
        setEditingAssemblyId(null)
        setInspectorOpen(true)
      }
      return
    }
    run()
  }

  const selected = scene.components.find(c => c.id === selectedId) ?? null
  const selectedGroup = assemblyForMember(scene, selectedId)

  const editingAssembly = selectedGroup?.id === editingAssemblyId ? selectedGroup : null
  const groupFullySelected = selectedGroup
    && selectedIds.length === selectedGroup.memberIds.length
    && selectedGroup.memberIds.every(id => selectedIds.includes(id))
  const selectedAssembly = !editingAssembly && groupFullySelected ? selectedGroup : null

  const ensureEditable = () => {
    if (running || snapshotRef.current.time > 0) {
      setToast(TOAST_NEED_RESET)
      return false
    }
    return true
  }

  const editMembers = (ids, apply) => {
    if (!ensureEditable()) return scene
    let base = scene
    if (needsSandbox(scene)) base = convertToSandbox(scene)
    const next = editAssemblyMembers(base, ids, apply)
    if (!hasSceneEdit(base, next)) return scene
    commitEdit(next)
    return next
  }

  const editMember = (id) => {
    const group = assemblyForMember(scene, id)
    if (!group || running || snapshotRef.current.time > 0) return
    const locked = scene.components.some(item => group.memberIds.includes(item.id) && item.locked)
    if (locked) {
      setToast(TOAST_NEED_UNLOCK)
      return
    }
    setSelectedId(id)
    setEditingAssemblyId(group.id)
    setCanvasTool('select')
    setInspectorOpen(true)
  }

  const finishMemberEdit = () => {
    setEditingAssemblyId(null)
    if (editingAssembly) setSelectedIds(editingAssembly.memberIds)
  }

  const finishAiDrawing = useCallback(() => {
    if (!aiDrawing?.scene) return
    pause()
    setAiDrawing(null)
    setToast('装置画好了')
  }, [aiDrawing, pause])

  const commit = useCallback((next) => setTimeline(current => commitHistory(current, next)), [])

  const commitEdit = (next) => {
    let editable = next
    if (needsSandbox(next)) editable = convertToSandbox(next)
    if (hasSceneEdit(scene, editable)) editable = beginParameterExperiment(editable)
    commit(editable)
  }

  const replaceScene = (next, after = () => {}, { preserveCurrent = false } = {}) => {
    const apply = () => {
      commit(next)
      setSelectedIds([])
      setEditingAssemblyId(null)
      after()
    }
    //这部分是换画布的代码
    if (!dirty || !scene.components.length) {
      apply();
      return;
    }
    if (preserveCurrent) {
      if (save()) apply();
      else setToast('存储空间已满')
      return;
    }
    setPendingReplacement({ apply })
  }

  const selectSubScenario = (variantId) => {
    if (!scene.scenarioVariants || running || aiDrawing) return;
    const next = rebindScenarioData(applySubquestionScenario(scene, variantId))
    resetScene(next)
    commit(next)
    const variant = next.scenarioVariants?.variants?.find(item => item.id === variantId)
    setToast(`已切换到${variant?.label ?? '所选小问'}的题目条件`)
  }

  const changeSubCondition = (variantId, deltaId, value) => {
    if (!scene.scenarioVariants || running || aiDrawing) return
    const next = rebindScenarioData(updateSubquestionDelta(scene, variantId, deltaId, value), { experiment: true })
    resetScene(next)
    commit(next)
    setToast('已修改当前小问的条件')
  }
  // const changeSubquestionCondition = (variantId, deltaId, value) => {
  //   if (!scene.scenarioVariants || running || aiDrawing) return
  //   const next = rebindScenarioConditionEvidence(updateSubquestionScenarioDelta(scene, variantId, deltaId, value), { experiment: true })
  //   resetScene(next)
  //   commit(next)
  //   setToast('已修改当前小问的条件')
  // }

  const startNewScene = () => {
    const next = createScene([], { title: '新建场景', source: 'manual', creationMode: 'manual' })
    const after = () => {
      setSavedKey('')
      setInspectorOpen(false)
      setSandboxOpen(false)
      setToast('已新建空白场景');
    }
    replaceScene(next, after)
  }

  //草稿防抖
  useEffect(() => {
    if (initialWorkspace.warning && scene === initialWorkspace.scene) {
      setDraftStatus('failed')
      return undefined
    }
    setDraftStatus('pending')
    const timer = window.setTimeout(() => {
      try {
        saveDraft(window.localStorage, scene)
        setDraftStatus('saved')
        setStorageError('')
      } catch {
        setDraftStatus('failed')
        setStorageError(TOAST_STORAGE_FULL)
      }

      // setStorageError('')
    }, DRAFT_SAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [scene])

  useEffect(() => {
    const protectDraft = (event) => {
      if (initialWorkspace.warning && scene === initialWorkspace.scene) return
      try {
        saveDraft(window.localStorage, scene)
      } catch {
        if (!dirty) return
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [scene, dirty])

  //TODO: 历史栈没设上限，如果你看到了，对就是你，记得修一下
  const undo = () => setTimeline((current) => {
    if (!current.past.length) return current
    const previous = current.past[current.past.length - 1]
    return {
      past: current.past.slice(0, -1),
      present: previous,
      future: [current.present, ...current.future]
    }
  })

  const redo = () => setTimeline((current) => {
    if (!current.future.length) return current
    return {
      past: [...current.past, current.present],
      present: current.future[0],
      future: current.future.slice(1)
    }
  })

  //换场景
  useEffect(() => {
    const availableIds = new Set(scene.components.map(item => item.id))
    setEditingAssemblyId((current) => {
      if (scene.assemblies?.some(group => group.id === current)) return current
      return null
    })
    setSelectedIds((current) => {
      const filtered = current.filter(id => availableIds.has(id))
      if (filtered.length === current.length) return current
      return filtered
    })
  }, [scene])

  useEffect(() => {
    saveTheme(dark)
  }, [dark])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!saveFeedback) return undefined
    const timer = window.setTimeout(() => setSaveFeedback(false), SAVE_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [saveFeedback])

  // 方向键tag {keydown的effect是不是太长了。。。
  const nudgeSelection = (key, shiftKey) => {
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const arrow = arrows[key]
    if (!arrow || !selectedIds.length || running || snapshotRef.current.time > 0) return
    const [dx, dy] = arrow
    // const selectedId = selectedIds[0]
    const step_size = shiftKey ? 10 : 1
    const delta = { x: dx * step_size, y: dy * step_size }
    if (editingAssembly) {
      editMembers(selectedIds, base => translateComponent(base, selectedId, delta, { snap: false }))
    } else {
      commitEdit(translateComponents(scene, selectedIds, delta))
    }
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (aiOpen || pendingReplacement || accountOpen || libraryOpen) return
      if (event.key === 'Escape' && editingAssembly && !isTextInput(event.target)) {
        event.preventDefault()
        finishMemberEdit()
        return
      }
      if (isEditingTarget(event.target)) return

      const withCommandKey = event.ctrlKey || event.metaKey
      if (withCommandKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
        return
      }
      if (withCommandKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }

      const wantsDelete = event.key === 'Delete' || event.key === 'Backspace'
      if (wantsDelete && selectedIds.length && !isTextInput(event.target)) {
        event.preventDefault()
        if (running || snapshotRef.current.time > 0) return
        const next = editMembers(selectedIds, base => selectedIds.reduce((acc, id) => removeComponent(acc, id), base))
        if (next === scene) {
          setToast('元件锁着或者跟别的组合连着，先解锁/解绑')
        } else {
          setSelectedIds([])
          setEditingAssemblyId(null)
        }
      }

      if (event.key.startsWith('Arrow') && selectedIds.length) {
        event.preventDefault()
        nudgeSelection(event.key, event.shiftKey)
      }

      const onControl = event.target.closest?.('button, summary, a')
      if (event.code === 'Space' && !onControl && !aiDrawing) {
        event.preventDefault()
        requestRun()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [scene, selectedIds, editingAssemblyId, running, snapshotRef, aiDrawing, aiOpen, pendingReplacement, accountOpen, libraryOpen])

  const selectComponent = (id, { additive = false } = {}) => {
    const next = selectAssemblyItem(scene, selectedIds, id, { additive, editingAssemblyId })
    setSelectedIds(next.ids)
    setEditingAssemblyId(next.editingAssemblyId)
    //注意点空白不要弹出属性面板
    if (id && !aiOpen) setInspectorOpen(true)
  }

  const selectComponents = (ids, { additive = false } = {}) => {
    setEditingAssemblyId(null)
    const nextIds = expandAssemblySelection(scene, ids)
    setSelectedIds((current) => {
      if (!additive) return nextIds
      const merged = [...expandAssemblySelection(scene, current), ...nextIds]
      return [...new Set(merged)]
    })
    if (nextIds.length && !aiOpen) setInspectorOpen(true)
  }

  const addTool = (tool) => {
    if (assemblyEditRequiresReset(scene, running, snapshotRef.current.time)) {
      setToast('复位加元件')
      return
    }
    let base = scene
    if (needsSandbox(scene)) base = convertToSandbox(scene)
    const next = addComponentForTool(base, tool)
    commitEdit(next)
    setFitRequest(value => value + 1)
    const created = next.components[next.components.length - 1]
    setSelectedId(created?.id ?? null)
    if (!aiOpen) setInspectorOpen(true)
  }

  const choosePreset = (key) => {
    const next = presetScene(key)
    const after = () => {
      const body = next.components.find(item => item.role === 'body')
      setSelectedId(body?.id ?? null)
      if (!aiOpen) setInspectorOpen(true)
      setToast(`已搭建「${next.title}」`)
    }
    replaceScene(next, after)
  }

  const addAssembly = (recipeId) => {
    if (running || snapshotRef.current.time > 0) {
      setToast('请先复位，再插入装置')
      return
    }
    try {
      let base = scene
      if (needsSandbox(scene)) base = convertToSandbox(scene)
      const next = insertAssembly(base, recipeId)
      commitEdit(next)
      setEditingAssemblyId(null)
      setSelectedIds(next.assemblies.at(-1).memberIds)
      if (!aiOpen) setInspectorOpen(true)
      setFitRequest(value => value + 1)
      setToast(`已添加${assemblyRecipe(recipeId).name}，可在右侧调整组合参数`)
    } catch (err) {
      setToast(err.message)
    }
  }

  const save = () => {
    try {
      const stored = saveSceneToStorage(window.localStorage, scene)
      setLibrary(current => [stored, ...current.filter(item => item.id !== stored.id)])
      setSavedKey(sceneContentKey(scene))
      setStorageError('')
      setSaveFailed(false)
      setSaveFeedback(true)
      // console.log('saved', scene.id, Date.now())
      return true
    } catch {
      setSaveFailed(true)
      setStorageError('存不进去了，本机存储不可用或满了，先导出备份')
      return false
    }
  }

  const openSceneLibrary = () => {
    try {
      setLibrary(readSceneLibrary(window.localStorage))
      setStorageError('')
    } catch {
      setStorageError('场景列表读不出来，记录还在，从备份里捞')
    }
    setLibraryOpen(true)
  }

  const openStoredScene = (item) => {
    setLibraryOpen(false)
    const after = () => {
      setSavedKey(sceneContentKey(item))
      if (aiSceneViewportIdentity(item)) setFitRequest(value => value + 1)
      setToast(`已打开「${item.title}」`)
    }
    replaceScene(item, after)
  }

  const deleteStoredScene = (item) => {
    try {
      const deleted = deleteSceneFromStorage(window.localStorage, item.id, { currentSceneId: scene.id })
      if (!deleted) return
      setLibrary(readSceneLibrary(window.localStorage))
      setStorageError('')
      if (item.id === scene.id) {
        setSavedKey('')
        setSaveFeedback(false)
        setToast('删掉并保留画布上的草稿')
      } else {
        setToast(`已删除「${item.title || '未命名场景'}」`)
      }
    } catch {
      setStorageError('本机存储不可用')
    }
  }

  const downloadJson = (data, fileName) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const exportScene = () => {
    const title = scene.title || '星驰视界场景'
    downloadJson(sceneForStorage(scene), `${title}.v3.json`)
  }

  // 本地排障走显式，免得渲染层的样本丢包
  const exportBuildRecord = () => {
    downloadJson({
      kind: 'construction-diagnostic',
      version: 1,
      scene,
      runtime: snapshotRef.current
    }, 'construction-diagnostic.json')
  }

  const importScene = async (file) => {
    if (!file) return
    try {
      if (file.size > IMPORT_SIZE_LIMIT) throw new Error('备份文件过大，请使用小于5MB的文件')
      const text = await file.text()
      const next = normalizeScene(prepareImportedScene(JSON.parse(text)))
      const after = () => {
        if (aiSceneViewportIdentity(next)) setFitRequest(value => value + 1)
        // 斜面滑块特殊处理
        if (next.motionModel?.family === 'fixed-incline-slide') {
          setToast('备份恢复好了，要继续生成的话原题得再传一次')
        } else {
          setToast('已恢复备份')
        }
      }
      replaceScene(next, after)
    } catch (err) {
      setToast(err instanceof Error ? err.message : '导入失败')
    }
    if (importRef.current) importRef.current.value = ''
  }

  // 下面这些是JSX里inline写不下抽出来的逻辑
  const rebuildFromProblem = () => {
    const rebuilt = rebuildRetainedProblem(scene)
    if (!rebuilt) {
      setToast('余留题目信息不足')
      return
    }
    const after = () => {
      setFitRequest(value => value + 1)
      setToast('按留下的题干和图片重新搭好了')
    }
    replaceScene(rebuilt, after, { preserveCurrent: true })
  }

  const restoreOriginalQuestion = () => {
    if (!ensureEditable()) return
    const original = structuredClone(scene.originalQuestion.scene)
    resetScene(original)
    commit(original)
    setFitRequest(value => value + 1)
    setSelectedIds([])
    setSelectedIds([]) //不置两次有可能选中清不掉
  }

  const configureSchoolProcess = (values) => {
    if (!ensureEditable()) return
    const next = configureSchoolProcessExperiment(scene, values)
    resetScene(next)
    commit(next)
    setFitRequest(value => value + 1)
    setSelectedIds([])
  }

  const updateSelectedAssembly = (patch) => {
    if (!ensureEditable()) return
    try {
      commitEdit(updateAssembly(scene, selectedAssembly.id, patch))
      setFitRequest(value => value + 1)
    } catch (err) {
      setToast(err.message)
    }
  }

  const dissolveSelectedAssembly = () => {
    if (!ensureEditable()) return
    commitEdit(dissolveAssembly(scene, selectedAssembly.id))
    setEditingAssemblyId(null)
    setSelectedId(selectedAssembly.slots.body ?? selectedId)
    setToast('已按模块拆分，没有变动元件和物理的连接')
  }

  const updateSelectedComponent = (patch) => {
    if (!ensureEditable()) return
    if (selected) {
      editMembers([selected.id], base => updateComponent(base, selected.id, patch))
      return
    }
    commitEdit(touchScene(scene, patch))
  }

  const updateContact = (leftId, rightId, patch) => {
    if (!ensureEditable()) return
    commitEdit(updateContactMaterial(scene, leftId, rightId, patch))
  }

  const updateRope = (ropeId, length) => editMembers([ropeId], base => updateRopeLength(base, ropeId, length))

  const updateAttachment = (constraintId, target, endpoint = 'end') => {
    editMembers([constraintId], base => updateConstraintAttachment(base, constraintId, target, endpoint))
  }

  const updateAttachmentMode = (constraintId, endpoint, mode) => {
    editMembers([constraintId], base => updateConstraintAttachmentMode(base, constraintId, endpoint, mode))
  }

  const handleAiBuild = (next, phase = 'instant') => {
    const readiness = sceneRunReadiness(next)
    const allowedModes = ['apparatus', 'exploratory']
    if (!readiness.ready && !allowedModes.includes(next.constructionDelivery?.mode)) {
      setToast(readiness.summary)
      return
    }
    const after = () => {
      setInspectorOpen(false)
      setAiOpen(false)
      setFitRequest(value => value + 1)
      if (phase === 'drawing') {
        pause()
        setAiDrawing({ key: `${Date.now()}-${next.revision ?? 0}`, scene: next })
      } else {
        runScene(next)
      }
      let message = '已生成物理演示'
      if (phase==='drawing') message='完成装置理解，正在绘制星驰视界';
      setToast(message);
    }
    replaceScene(next, after, { preserveCurrent: true })
  }

  //任意成员被选中亮起组合体的按钮
  const isObjectPressed = (item) => {
    if (!item.memberIds) return selectedIds.includes(item.id)
    return item.memberIds.some(id => selectedIds.includes(id))
  }

  //JSX里面只留个插值
  const constructionProcess = sceneConstructionProcess(scene)
  const phaseScopeLabel = selectedPhaseScopeLabel(constructionProcess)
  const covered = aiOpen || Boolean(pendingReplacement) || accountOpen || libraryOpen
  const hasScenarios = Boolean(scene.scenarioVariants?.variants?.length)

  let shellClass = 'app-shell notranslate'
  if (dark) shellClass += ' is-dark'

  let menuClass = 'scene-menu-content'
  if (moreMenu.expanded) menuClass += ' is-open'

  //保存态
  const saveStates = {
    error: ['is-error','!','保存失败', storageError],
    dirty: ['is-dirty','•', '未保存', '有更改尚未保存到本机'],
    saved: ['is-saved','✓','已保存到本机', '已保存到当前浏览器'],
  }
  const save_key = saveFailed ? 'error' : dirty ? 'dirty' : 'saved'
  const [saveStateClass, saveStateIcon, saveStateText, saveStateTitle] = saveStates[save_key]

  const saveButtonText = saveFailed ? '重试' : '保存'
  const accountLabel = accountState.demo ? '体验账户' : account ? '账户' : '登录'
  const accountTarget = account ? 'membership' : 'login'
  const accountTitle = account?.displayName|| '登录与会员积分'
  const accountPoints = account ? account.points.toLocaleString('zh-CN') : ''
  const pointsBadge = account?<small className="top-points">{accountPoints} 积分</small> : null

  const menuAccountPoints = account && (
    <button className="menu-account-points" onClick={() => accountStore.open('points')}>
      可用积分：{accountPoints}
    </button>
  )

  const themeIcon = dark ? <Sun size={16}/> : <Moon size={16} />
  const themeLabel = dark?'切换白板' : '切换黑板'

  const constructionRecordItem=import.meta.env.DEV && scene.problemAnalysis
    ?<button onClick={exportBuildRecord}><Download size={16} />导出构建记录</button>
    :null

  let rebuildItem = null
  const canRebuildFromProblem = scene.problemAnalysis?.recognizedText
    &&scene.reviewRecord?.source !=='untrusted-import'
  if(canRebuildFromProblem) {
    rebuildItem = <button onClick={rebuildFromProblem}>根据原题重新搭建</button>
  }

  let phaseScopeButton = null
  if (phaseScopeLabel) {
    phaseScopeButton = (
      <button className="selected-phase-scope" type="button" onClick={() => setInspectorOpen(true)}
        title={constructionProcess.limitation}
        aria-label={`${phaseScopeLabel}；查看演示范围与参数`}>
        {phaseScopeLabel}
        <span>查看范围与参数</span>
      </button>
    )
  }

  let onboarding = null
  if (!scene.components.length) {
    const examplePresets = PRESETS.filter(([key]) => ['freefall', 'incline', 'spring'].includes(key))
    onboarding = (
      <div className="canvas-onboarding">
        <strong>从一个小球，或一道题开始</strong>
        <p>上传题目生成演示，或者使用下方组件自由搭建。</p>
        <button onClick={() =>setAiOpen(true)}>上传题目 / 输入题干</button>
        <button onClick={() =>{setSandboxOpen(true); setPaletteMode('presets') }}>打开经典场景</button>
        <div className="onboarding-examples">
          <span>试一试</span>
          {examplePresets.map(([key, label]) => (
            <button type="button" key={key} onClick={() => choosePreset(key)}>{label}</button>
          ))}
        </div>
      </div>
    )
  }

  let aiDrawingBadge = null
  if (aiDrawing) {
    aiDrawingBadge = (
      <div className="ai-drawing-badge" role="status" aria-live="polite">
        <AiConstructionMark active />
        <span>正在绘制演示</span>
        <button onClick={finishAiDrawing}>跳过绘制</button>
      </div>
    )
  }

  // 只在原题还留着场景时才给恢复原条件
  const restoreOriginalHandler = scene.originalQuestion?.scene ? restoreOriginalQuestion : null

  let schoolProcessPanel = null
  if (scene.schoolProcess) {
    schoolProcessPanel = (
      <SchoolProcessParameters key={`${scene.id}:${scene.schoolProcess.status}`}
        process={scene.schoolProcess}
        disabled={running || started || Boolean(aiDrawing)}
        onRestore={restoreOriginalHandler}
        onConfigure={configureSchoolProcess} />
    );
  }
  // let listedObjects = listedComponents(scene)
  // listedObjects=listedObjects.filter(item => item.name item.memberIds)

  let objectRows = null
  if (listedObjects.length) {
    objectRows = listedObjects.map((item, i) => (
      <button key={item.id} aria-pressed={isObjectPressed(item)} onClick={() => selectComponent(item.memberIds?.[0] ?? item.id)}>
        <span>{item.name||'元件'}</span>
        <small>{i + 1}</small>
      </button>
    ))
  }

  let emptyObjectNote = null
  if (!scene.components.length) {
    emptyObjectNote = <p className="context-note">还没有对象。从下方组件库添加一个装置。</p>
  }

  let replacementDialog = null
  if (pendingReplacement) {
    const keepAndContinue = () => {
      if (!save()) return
      pendingReplacement.apply()
      setPendingReplacement(null)
    }
    const discardAndContinue = () => {
      pendingReplacement.apply()
      setPendingReplacement(null)
    }
    replacementDialog = (
      <ConfirmationDialog title="保留当前画布吗？" confirmLabel="不保存，继续"
        onClose={() => setPendingReplacement(null)} onSave={keepAndContinue} onConfirm={discardAndContinue}>
        <p>当前画布有未保存更改。可以先保存，也可以直接继续。</p>
      </ConfirmationDialog>
    )
  }

  const accountDialog = accountOpen ? <AccountDialog /> : null
  const toastView = toast && <div className="toast" role="status"><Zap size={15} />{toast}</div>

  return (
    <div className={shellClass} translate="no">
      <header className="topbar" inert={covered}>
        <div className="brand-lockup" role="img" aria-label="星驰视界 AI 物理画布">
          <div className="brand-mark"><ConstructCore size={46} /></div>
          <div className="brand-wordmark">
            {/* <svg className="brand-logo" viewBox="0 0 120 120" role="img" aria-label="星驰视界" focusable="false">
              <use href="/xingchi-vision-logo.svg?v=pendulum-04#brand-logo" />
            </svg> */}
            <div className="brand-title-line">
              <svg className="brand-lettering" viewBox="0 0 516 124" role="img" aria-label="星驰视界" focusable="false">
                <use href="/xingchi-vision-wordmark.svg?v=pendulum-04#brand-wordmark" />
              </svg>
              <small>AI 物理画布</small>
            </div>
          </div>
        </div>
        <div className="scene-heading">
          <span className="storage-badge" title="画布保存在当前浏览器">本机</span>
          <SceneTitle key={scene.id} title={scene.title} onRename={title => commit({ ...scene, title })} />
          <button type="button" className="icon-button new-scene-entry" aria-label="新建场景"
            title="新建空白场景" onClick={startNewScene}><Plus size={18} /></button>
        </div>
        <div className="top-actions">
          <div className="history-actions" role="group" aria-label="编辑历史">
            <IconButton label="撤销" title="撤销 Ctrl+Z / ⌘Z" icon={Undo2}
              disabled={!timeline.past.length} onClick={undo} />
            <IconButton label="重做" title="重做 Ctrl+Shift+Z / ⌘Shift+Z" icon={Redo2}
            //  disabled={!timeline.future.length} onClick={redo} />``
              disabled={!timeline.future.length} onClick={redo} />
          </div>
          <div className="save-actions">
            <span className={`save-state ${saveStateClass}`} role="status" title={saveStateTitle}>
              <span aria-hidden="true">{saveStateIcon}</span>
              <span className="save-state-text">{saveStateText}</span>
            </span>
            <button className="save-button" aria-label="保存" title="保存到本机 Ctrl+S / ⌘S" onClick={save}>
              <Save size={16} /><span>{saveButtonText}</span>
            </button>
          </div>
          <button className="account-entry" type="button" aria-label="登录与会员积分"
            title={accountTitle} onClick={() => accountStore.open(accountTarget)}>
            <UserRound size={17} />
            <span>{accountLabel}</span>
            {pointsBadge}
          </button>
          <details ref={moreMenu.ref} open={moreMenu.mounted} className="scene-menu workspace-more">
            <summary aria-label="更多场景操作" title="更多场景操作" aria-expanded={moreMenu.expanded}
              onClick={toggleMoreMenu}>
              <MoreHorizontal size={18} aria-hidden="true" focusable="false" />
            </summary>
            <div className={menuClass} onClick={() => moreMenu.close()}>
              <button aria-label="打开本机画布" onClick={openSceneLibrary}><FolderOpen size={16} />打开本机画布</button>
              {menuAccountPoints}
              <button onClick={() => setDark(value => !value)}>{themeIcon}{themeLabel}</button>
              <button onClick={exportScene}><Download size={16} />备份画布</button>

              {constructionRecordItem}
              {rebuildItem}
              <button onClick={() => importRef.current?.click()}><Upload size={16} />恢复备份</button>
            </div>
          </details>
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json"
            onChange={(event) => importScene(event.target.files?.[0])} />
        </div>
      </header>

      <main className="workspace" inert={covered}>
        <div className="canvas-stage">
          <BoardCanvas scene={scene} editingAssemblyId={editingAssembly?.id} onEditMember={editMember}
            fitRequest={fitRequest} onFit={() => setFitRequest(value => value + 1)}
            drawing={aiDrawing} onDrawingComplete={finishAiDrawing}
            positions={positions} compositeBodies={compositeBodies} constraintPositions={constraintPositions}
            simulationTime={renderTime} runtimeFrame={runtimeFrame} compounds={compounds}
            running={running} selectedIds={selectedIds} activeTool={canvasTool}
            onSelect={selectComponent} onSelection={selectComponents}
            onBlankPointerDown={() => { setSandboxOpen(false); finishMemberEdit() }}
            onPause={pause} onEditBlocked={setToast} onCommit={commitEdit} />

          <div className="playback-toolbar" aria-label="演示控制">
            <PlaybackControls runtimeSnapshot={runtimeSnapshot} scene={scene} running={running}
              aiDrawing={aiDrawing} runReadiness={runReadiness} playbackRate={playbackRate}
              onChangeRate={changePlaybackRate} onRun={requestRun} onReset={reset} onStep={step} />
          </div>
          {phaseScopeButton}
          {onboarding}
          <button className="canvas-object-toggle" data-context-trigger aria-expanded={objectsOpen}
            onClick={() => setObjectsOpen(value => !value)}>对象列表</button>
          {aiDrawingBadge}

          <ComponentPalette open={sandboxOpen} mode={paletteMode} onMode={setPaletteMode}
            onAdd={addTool} onAssembly={addAssembly} assemblyDisabled={running || started}
            onPreset={choosePreset}

            onGlobal={() => { setSelectedId(null); setInspectorOpen(true) }} />

          <BottomDock activeTool={canvasTool} onToolChange={setCanvasTool} sandboxOpen={sandboxOpen}
            onSandbox={() => setSandboxOpen(value => !value)} onAdd={addTool} onAi={() => setAiOpen(true)} />
        </div>
        <WorkspacePanel open={panelOpen} pane={pane}
          contentKey={`${scene.scenarioVariants?.activeId ?? ''}:${selectedAssembly?.id ?? selected?.id ?? 'global'}`}
          hasScenarios={hasScenarios} onToggle={() => setPanelOpen(value => !value)}>
          <SubquestionScenarioPanel compact scenarios={scene.scenarioVariants}
            disabled={running || Boolean(aiDrawing)}
            onSelect={selectSubScenario} onDeltaChange={changeSubCondition} />
          <div className="context-pane" hidden={pane !== 'properties'}>
            <ConstructionScopeNotice process={constructionProcess} />
            {schoolProcessPanel}
            <RuntimePhysicsInspector runtimeSnapshot={runtimeSnapshot}
              active={panelOpen && pane === 'properties'}
              scene={scene} selected={selected} selectedIds={selectedIds} selectedAssembly={selectedAssembly}
              compositeBodies={compositeBodies} editingAssembly={editingAssembly}
              onEditMember={editMember} onFinishMemberEdit={finishMemberEdit}
              onAssemblyUpdate={updateSelectedAssembly}
              onDissolve={dissolveSelectedAssembly}
              running={running} onReset={reset}
              onUpdate={updateSelectedComponent}
              onContactUpdate={updateContact}
              onRopeLength={updateRope}
              onConstraintAttachment={updateAttachment}
              onConstraintAttachmentMode={updateAttachmentMode}
              onClose={() => setPanelOpen(false)} />
          </div>

          <div className="context-pane" hidden={pane !== 'objects'}>
            <section className="context-object-list" aria-label="场景对象">
              <header><h2>场景对象</h2><span>{listedObjects.length} 个元件</span></header>
              {objectRows}
              {emptyObjectNote}
              <p className="context-note">选择对象查看属性。方向键移动，Shift 加速，Delete 删除；编辑初始条件前请复位。</p>
            </section>
          </div>
        </WorkspacePanel>
      </main>

      <AiBuilder open={aiOpen} covered={Boolean(pendingReplacement) || accountOpen || libraryOpen}
        currentAnalysis={scene.problemAnalysis} onClose={() => setAiOpen(false)} onBuild={handleAiBuild} />

      <SceneLibraryDialog open={libraryOpen} scenes={library} currentScene={scene} dirty={dirty}
        draftStatus={draftStatus} saveFeedback={saveFeedback} account={account}
        renderPreview={assetScene => <SceneCanvasThumbnail scene={assetScene} />}
        onClose={() => setLibraryOpen(false)} onRename={title => commit(touchScene(scene, { title }))}
        onSave={save} onOpen={openStoredScene} onDelete={deleteStoredScene}
        onLogin={() => { setLibraryOpen(false); accountStore.open('login') }} />

      {replacementDialog}
      {accountDialog}
      {toastView}
    </div>
  )
}

function BodyShape({ item, wheelRotation = 0, selected, annotationsVisible, showAnnotations = selected, pixelsPerMeter = DEFAULT_PIXELS_PER_METER, onPointerDown, onResize }) {
  const visualPose = bodyVisualPose(item)
  const pad =3
  const showVectors = showAnnotations && annotationsVisible
  const isCompound = item.visualShape === 'compound-body'

  // 把手只给够大的形状：薄木板挂上边把手就和角把手挤成一团了
  const showEdgeHandles = (side) => {
    const shorter = Math.min(side.width, side.height)
    const longer = Math.max(side.width, side.height)
    return shorter >= 56 && longer >= 160
  }

  let shapeClass = 'body-shape'
  if (selected) shapeClass += ' selected'

  if (item.kind === 'ball') {
    let selectionRing = null
    if (selected) selectionRing = <circle className="selection-ring" r={item.radius + pad} />

    let compoundLabel = null
    if (isCompound) {
      compoundLabel = (
        <text className="compound-body-label" textAnchor="middle" dominantBaseline="central">{item.displayLabel}</text>
      )
    }

    let vectors = null
    if (showVectors) vectors = <BodyVectors item={item} pixelsPerMeter={pixelsPerMeter} />

    // 球的角点缩放
    let ballHandles = null
    if (selected && !isCompound) {
      ballHandles = <BallHandles radius={item.radius + pad} onResize={onResize} />
    }

    return (
      <g className={shapeClass} transform={`translate(${visualPose.x} ${visualPose.y})`} onPointerDown={onPointerDown}>
        {selectionRing}
        <BodyAppearance item={item} />
        {compoundLabel}
        {vectors}
        {ballHandles}
      </g>
    )
  }

  let poseAngle = Number(item.angle ?? 0)
  if (Number.isFinite(Number(visualPose.angle))) poseAngle = Number(visualPose.angle)
  const angleDegrees = poseAngle * 180 / Math.PI

  // 接触面朝向的物体
  let counter_rot = 0
  if (Number.isFinite(Number(item.contactAngle))) {
    counter_rot = -Number(item.contactAngle) * 180 / Math.PI
  }

  if (item.kind === 'groove' || item.kind === 'half-groove') {
    const grooveGeometry = grooveVisualGeometry(item)
    const bounds = grooveGeometry.visualBounds
    const half_w = bounds.width / 2;
    const half_h = bounds.height / 2;
    const connectorPath = grooveGeometry.connectors
      .map(({ start, end }) => `M ${start.x} ${start.y} L ${end.x} ${end.y}`)
      .join(' ')

    let selectionRing = null
    if (selected) {
      selectionRing = (
        <rect className="selection-ring" x={bounds.minX - pad} y={bounds.minY - pad}
          width={bounds.width + pad * 2} height={bounds.height + pad * 2} />
      )
    }

    let vectors = null
    if (showVectors) vectors = <BodyVectors item={item} pixelsPerMeter={pixelsPerMeter} />

    let handles = null
    if (selected) {
      handles = (
        <g transform={`translate(${bounds.centerX} ${bounds.centerY})`}>
          <EdgeHandles halfWidth={half_w + pad}
            halfHeight={half_h + pad} onResize={onResize} show={showEdgeHandles(bounds)} />
          <CornerHandles halfWidth={half_w + pad}
            halfHeight={half_h + pad} onResize={onResize} />
        </g>
      )
    }

    return (
      <g className={`${shapeClass} composite-track-body`} transform={`translate(${item.x} ${item.y}) rotate(${angleDegrees})`} onPointerDown={onPointerDown}>
        <rect className="component-hit-area" x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} />
        {selectionRing}
        <path className="diagram-body groove-frame" d={`${grooveGeometry.framePath} ${connectorPath}`} />
        <path className="support-outline groove-track" d={grooveGeometry.trackPath} />
        {vectors}
        {handles}
      </g>
    )
  }

  if (item.kind === 'wedge') {
    const wedgePoints = `${-item.width / 2},${-item.height / 2} ${-item.width / 2},${item.height / 2} ${item.width / 2},${item.height / 2}`

    let selectionRing = null
    if (selected) {
      selectionRing = (
        <rect className="selection-ring" x={-item.width / 2 - pad} y={-item.height / 2 - pad}
          width={item.width + pad * 2} height={item.height + pad * 2} />
      )
    }

    let vectors = null
    if (showVectors) vectors = <BodyVectors item={item} pixelsPerMeter={pixelsPerMeter} />

    let handles = null
    if (selected) {
      handles = (
        <>
          <EdgeHandles halfWidth={item.width / 2 + pad} halfHeight={item.height / 2 + pad}
            onResize={onResize} show={showEdgeHandles(item)} />
          <CornerHandles halfWidth={item.width / 2 + pad} halfHeight={item.height / 2 + pad}
            onResize={onResize} />
        </>
      )
    }

    return (
      <g className={shapeClass} transform={`translate(${item.x} ${item.y}) rotate(${angleDegrees})`} onPointerDown={onPointerDown}>
        {selectionRing}
        <polygon className="diagram-body wedge-body" points={wedgePoints} />
        {vectors}
        {handles}
      </g>
    )
  }

  let openBoxBounds = null
  if (item.bodyStyle === 'open-box') openBoxBounds = openBoxVisualGeometry(item).visualBounds

  const selectionX = openBoxBounds?.minX ?? -item.width / 2
  const selectionY = openBoxBounds?.minY ?? -item.height / 2
  const selectionWidth = openBoxBounds?.width ?? item.width
  const selectionHeight = openBoxBounds?.height ?? item.height

  let selectionRing = null
  if (selected) {
    selectionRing = (
      <rect className="selection-ring" x={selectionX - pad} y={selectionY - pad}
        width={selectionWidth + pad * 2} height={selectionHeight + pad * 2} />
    )
  }

  let hitArea = null
  if (['cart', 'weight', 'open-box'].includes(item.bodyStyle)) {
    hitArea = <rect className="component-hit-area" x={selectionX} y={selectionY}
      width={selectionWidth} height={selectionHeight} />
  }

  let compoundLabel = null
  if (isCompound) {
    compoundLabel = (
      <text className="compound-body-label" textAnchor="middle" dominantBaseline="central"
        transform={`rotate(${-angleDegrees})`}>{item.displayLabel}</text>
    )
  }

  let vectors = null
  if (showVectors) {
    if (counter_rot) {
      vectors = <g transform={`rotate(${counter_rot})`}><BodyVectors item={item} pixelsPerMeter={pixelsPerMeter} /></g>
    } else {
      vectors = <BodyVectors item={item} pixelsPerMeter={pixelsPerMeter} />
    }
  }

  let handles = null
  if (selected && !isCompound) {
    handles = (
      <>
        <EdgeHandles halfWidth={selectionWidth / 2 + pad}
          halfHeight={selectionHeight / 2 + pad} onResize={onResize}
          show={showEdgeHandles({ width: selectionWidth, height: selectionHeight })} />
        <CornerHandles halfWidth={selectionWidth / 2 + pad}
          halfHeight={selectionHeight / 2 + pad} onResize={onResize} />
      </>
    )
  }

  return (
    <g className={shapeClass} transform={`translate(${visualPose.x} ${visualPose.y}) rotate(${angleDegrees})`} onPointerDown={onPointerDown}>
      {selectionRing}
      {hitArea}
      <BodyAppearance item={item} wheelRotation={wheelRotation} />
      {compoundLabel}
      {vectors}
      {handles}
    </g>
  )
}

// 摩擦
export function FrictionZones({ item }) {
  const zones = Array.isArray(item.frictionZones) ? item.frictionZones : []

  const dx = Number(item.x2) - Number(item.x1)
  const dy = Number(item.y2) - Number(item.y1)
  const length = Math.hypot(dx, dy)
  if (!zones.length || !(length > 0)) return null

  const ux = dx / length
  const uy = dy / length
  const dir = dx >= 0 ? 1 : -1
  const nx = -uy * dir
  const ny = ux * dir

  const depth= 9
  const offset = Number(item.thickness ?? 0) / 2

  return (
    <g className="friction-zones">
      {zones.map((zone, index) => {
        const at = (along) => ({
          x: Number(item.x1) + ux * along + nx * offset,
          y: Number(item.y1) + uy * along + ny * offset
        })
        const a = at(zone.start)
        const b = at(zone.end)
        const points = [a, b, { x: b.x + nx * depth, y: b.y + ny * depth }, { x: a.x + nx * depth, y: a.y + ny * depth }]
          .map(point => `${point.x},${point.y}`)
          .join(' ')

        const zoneLabel = zone.label || '摩擦区'
        const label = zone.source === 'representative'
          ? `动摩擦因数 ${zone.friction}（示例值）`
          : `动摩擦因数 ${zone.friction}`

        return (
          <polygon key={index} className="friction-zone" points={points}
            aria-label={`${zoneLabel}：${label}`} />
        )
      })}
    </g>
  )
}

function EdgeHandles({ halfWidth, halfHeight, onResize, show = true }) {
  if (!show) return null
  const handles = [
    ['n', '上边', 0, -halfHeight, 12, 5],
    ['e', '右边', halfWidth, 0, 5, 12],
    ['s', '下边', 0, halfHeight, 12, 5],
    ['w', '左边', -halfWidth, 0, 5, 12]
  ]
  return (
    <g className="edge-resize-handles">
      {handles.map(([handle, label, x, y, width, height]) => (
        <rect key={handle} className={`edge-resize-handle handle-${handle}`} aria-label={`拉伸${label}`}
          x={x - width / 2} y={y - height / 2} width={width} height={height} rx="3"
          onPointerDown={(event) => onResize(event, handle)} />
      ))}
    </g>
  )
}

function BallHandles({ radius, onResize }) {
  const offset = radius * Math.SQRT1_2
  const handles = [
    ['nw', -offset, -offset],
    ['ne', offset, -offset],
    ['se', offset, offset],
    ['sw', -offset, offset]
  ]
  return (
    <g className="resize-handles ball-resize-handles">
      {handles.map(([handle, x, y]) => (
        <circle key={handle} className={`resize-handle ball-resize-handle handle-${handle}`}
          aria-label={`缩放${handle.toUpperCase()}`} cx={x} cy={y} r="4"
          onPointerDown={(event) => onResize(event, handle)} />
      ))}
    </g>
  )
}

function CornerHandles({ halfWidth, halfHeight, onResize }) {
  const pts = []
  for (const [handle, sx, sy] of [['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1]]) {
    pts.push(
      <circle key={handle} className={`resize-handle handle-${handle}`}
        aria-label={`缩放${handle.toUpperCase()}`} cx={sx * halfWidth} cy={sy * halfHeight} r="4"
        onPointerDown={(event) => onResize(event, handle)} />
    )
  }
  return <g className="resize-handles">{pts}</g>
}

function BodyVectors({ item, pixelsPerMeter = DEFAULT_PIXELS_PER_METER }) {
  const forceMagnitude = Number(item.forceMagnitude ?? 0)
  const vx = Number(item.vx ?? 0)
  const vy = Number(item.vy ?? 0)
  const speed = Math.hypot(vx, vy) / pixelsPerMeter
  const velocityAngle = normalizedDegrees(Math.atan2(-vy, vx) * 180 / Math.PI)

  let forceArrow = null
  if (forceMagnitude > 0.001) {
    forceArrow = <VectorArrow angle={item.forceAngle} length={Math.min(118, 44 + forceMagnitude * 4)} label="F" kind="force" />
  }

  let velocityArrow = null
  if (speed > 0.01) {
    velocityArrow = <VectorArrow angle={velocityAngle} length={Math.min(105, 38 + speed * 10)} label="v" kind="velocity" />
  }

  return (
    <g className="body-vectors" aria-hidden="true">
      {forceArrow}
      {velocityArrow}
    </g>
  )
}

function VectorArrow({ angle, length, label, kind }) {
  const radians = Number(angle ?? 0)*Math.PI/180;
  const x = Math.cos(radians) *length;
  const y = -Math.sin(radians) *length;
  const arrow= 8;
  const wing = 4.5;
  const ux = x / length;
  const uy = y / length;
  const px = -uy;
  const py = ux;
  const points = `${x},${y} ${x - ux * arrow + px * wing},${y - uy * arrow + py * wing} ${x - ux * arrow - px * wing},${y - uy * arrow - py * wing}`
  return (
    <g className={`vector-arrow ${kind}`}>
      <line x1="0" y1="0" x2={x} y2={y} />
      <polygon points={points} />
      <text x={x + px * 9} y={y + py * 9}>{label}</text>
    </g>
  )
}

function SupportShape({ item, visualItem = item, simulationTime = 0, selected, annotationsVisible, showAnnotations = selected, showEditorAngle = true, onPointerDown, onResize }) {
  const handles = editorSupportHandles(item)
  const showAngleGuide = showAnnotations && annotationsVisible && showEditorAngle

  let shapeClass = ''
  if (selected) shapeClass = 'selected'

  if (item.semanticType === 'kinematics-axis') {
    const start = { x: Number(visualItem.x1), y: Number(visualItem.y1) }
    const end = { x: Number(visualItem.x2), y: Number(visualItem.y2) }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy) || 1
    const tx = dx / length
    const ty = dy / length
    const nx = -ty
    const ny = tx
    const arrow = `${end.x},${end.y} ${end.x - tx * 11 + nx * 5},${end.y - ty * 11 + ny * 5} ${end.x - tx * 11 - nx * 5},${end.y - ty * 11 - ny * 5}`
    const label_dx = nx * 18
    const label_dy = ny * 18 + 5

    let min_r = 0
    if (Number.isFinite(item.axisMinimumTickRatio)) min_r = item.axisMinimumTickRatio
    let max_r = 1
    if (Number.isFinite(item.axisMaximumTickRatio)) max_r = item.axisMaximumTickRatio

    const minimumTick = { x: start.x + dx * min_r, y: start.y + dy * min_r }
    const maximumTick = { x: start.x + dx * max_r, y: start.y + dy * max_r }
    const tickSpan = Math.hypot(maximumTick.x - minimumTick.x, maximumTick.y - minimumTick.y)
    const distinctTicks = tickSpan > 1

    let maximumTickLine = null
    let maximumTickLabel = null
    if (distinctTicks) {
      maximumTickLine = (
        <line className="kinematics-axis-tick" x1={maximumTick.x - nx * 6} y1={maximumTick.y - ny * 6}
          x2={maximumTick.x + nx * 6} y2={maximumTick.y + ny * 6} />
      )
      maximumTickLabel = (
        <text className="kinematics-axis-value" x={maximumTick.x + label_dx} y={maximumTick.y + label_dy}
          textAnchor="middle">{formatNumericValue(item.axisMaximum)} {item.axisUnit}</text>
      )
    }

    return (
      <g className="kinematics-axis" aria-label="运动学参考轴">
        <line className="support-outline kinematics-axis-line" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
        <polygon className="kinematics-axis-arrow" points={arrow} />
        <line className="kinematics-axis-tick" x1={minimumTick.x - nx * 6} y1={minimumTick.y - ny * 6}
          x2={minimumTick.x + nx * 6} y2={minimumTick.y + ny * 6} />
        {maximumTickLine}
        <text className="kinematics-axis-value" x={minimumTick.x + label_dx} y={minimumTick.y + label_dy}
          textAnchor="middle">{formatNumericValue(item.axisMinimum)} {item.axisUnit}</text>
        {maximumTickLabel}
        <text className="kinematics-axis-label" x={end.x + tx * 18} y={end.y + ty * 18 + 5}>{item.axisLabel || 'x'}</text>
      </g>
    )
  }

  if (item.kind === 'conveyor') {
    const dx = Number(visualItem.x2) - Number(visualItem.x1)
    const dy = Number(visualItem.y2) - Number(visualItem.y1)
    const length = Math.hypot(dx, dy) || 1
    const tx = dx / length
    const ty = dy / length
    let upX = -ty
    let upY = tx
    //法线
    if (upY > 0) {
      upX *= -1
      upY *= -1
    }
    const radius = Math.max(11, Number(visualItem.thickness ?? 44) / 2)
    const topStart = { x: visualItem.x1 + upX * radius, y: visualItem.y1 + upY * radius }
    const topEnd = { x: visualItem.x2 + upX * radius, y: visualItem.y2 + upY * radius }
    const bottomStart = { x: visualItem.x1 - upX * radius, y: visualItem.y1 - upY * radius }
    const bottomEnd = { x: visualItem.x2 - upX * radius, y: visualItem.y2 - upY * radius }
    const beltMarkers = conveyorBeltMarkers(item, simulationTime)

    let selectionLine = null
    let endpointHandles = null
    if (selected) {
      selectionLine = <line className="selection-line" x1={topStart.x} y1={topStart.y} x2={topEnd.x} y2={topEnd.y} />
      endpointHandles = (
        <>
          <EndpointHandle point={handles.start} handle="start" onResize={onResize} />
          <EndpointHandle point={handles.end} handle="end" onResize={onResize} />
        </>
      )
    }

    return (
      <g className={`conveyor-shape ${shapeClass}`} onPointerDown={onPointerDown}>
        {selectionLine}
        <line className="support-outline conveyor-edge" x1={topStart.x} y1={topStart.y} x2={topEnd.x} y2={topEnd.y} />
        <line className="support-outline conveyor-edge" x1={bottomStart.x} y1={bottomStart.y} x2={bottomEnd.x} y2={bottomEnd.y} />
        <circle className="conveyor-roller" cx={item.x1} cy={item.y1} r={radius} />
        <circle className="conveyor-roller" cx={item.x2} cy={item.y2} r={radius} />
        {beltMarkers.map((marker, index) => (
          <line key={index} className="conveyor-belt-mark" x1={marker.x1} y1={marker.y1} x2={marker.x2} y2={marker.y2} />
        ))}
        {endpointHandles}
      </g>
    )
  }

  if (item.kind === 'arc') {
    const visual = arcVisualGeometry(visualItem)
    const fullCircle = visual.fullCircle
    const start = polar(visual.cx, visual.cy, visual.radius, visual.startAngle)
    let endAngle = visual.endAngle
    if (fullCircle) endAngle = visual.startAngle + Math.PI * 2
    const end = polar(visual.cx, visual.cy, visual.radius, endAngle)
    let large = 0
    if (arcSweepRadians(visual.startAngle, endAngle, fullCircle) > Math.PI) large = 1

    let outline = null
    if (fullCircle) {
      outline = <circle className="support-outline full-circle" cx={visual.cx} cy={visual.cy} r={visual.radius} fill="none" />
    } else {
      outline = (
        <path className="support-outline" d={`M ${start.x} ${start.y} A ${visual.radius} ${visual.radius} 0 ${large} 1 ${end.x} ${end.y}`} fill="none" />
      )
    }

    let angleGuide = null
    if (showAngleGuide) angleGuide = <ArcAngleGuide item={item} start={start} end={end} />

    let endpointHandles = null
    if (selected) {
      endpointHandles = (
        <>
          <EndpointHandle point={handles.start} handle="start" onResize={onResize} />
          <EndpointHandle point={handles.end} handle="end" onResize={onResize} />
        </>
      )
    }

    return (
      <g className={shapeClass} onPointerDown={onPointerDown}>
        {outline}
        {angleGuide}
        {endpointHandles}
      </g>
    )
  }

  const surface = supportVisualSurface(visualItem)

  // 无限长的地面和无限碰撞范围d处理(锚点)
  let infiniteHatchAnchor = null
  const infiniteExtent = item.collisionExtent === 'infinite'
    || (item.semanticType === 'ground' && item.collisionExtent !== 'finite')
  if (infiniteExtent) infiniteHatchAnchor = supportVisualSurface(item)

  if (item.kind === 'incline') {
    const outline = inclineVisualOutline(visualItem)

    let selectionLine = null
    if (selected) {
      selectionLine = <line className="selection-line" x1={outline.slopeStart.x} y1={outline.slopeStart.y}
        x2={outline.slopeEnd.x} y2={outline.slopeEnd.y} />
    }

    let angleGuide = null
    if (showAngleGuide) angleGuide = <SupportAngleGuide item={supportVisualSurface(item)} />

    let endpointHandles = null
    if (selected) {
      endpointHandles = (
        <>
          <EndpointHandle point={handles.start} handle="start" onResize={onResize} />
          <EndpointHandle point={handles.end} handle="end" onResize={onResize} />
        </>
      )
    }

    return (
      <g className={shapeClass} onPointerDown={onPointerDown}>
        {selectionLine}
        <line className="support-outline" x1={outline.slopeStart.x} y1={outline.slopeStart.y}
          x2={outline.slopeEnd.x} y2={outline.slopeEnd.y} />
        {angleGuide}
        {endpointHandles}
      </g>
    )
  }

  let selectionLine = null
  if (selected) {
    selectionLine = <line className="selection-line" x1={surface.x1} y1={surface.y1} x2={surface.x2} y2={surface.y2} />
  }

  let hatching = null
  if (item.hatch !== false) hatching = <SurfaceHatching item={surface} worldAnchor={infiniteHatchAnchor} />

  let angleGuide = null
  if (showAngleGuide) angleGuide = <SupportAngleGuide item={supportVisualSurface(item)} />

  let endpointHandles = null
  if (selected) {
    endpointHandles = (
      <>
        <EndpointHandle point={handles.start} handle="start" onResize={onResize} />
        <EndpointHandle point={handles.end} handle="end" onResize={onResize} />
      </>
    )
  }

  return (
    <g className={shapeClass} onPointerDown={onPointerDown}>
      {selectionLine}
      <line className="support-outline" x1={surface.x1} y1={surface.y1} x2={surface.x2} y2={surface.y2} />
      {hatching}
      <FrictionZones item={item} />
      {angleGuide}
      {endpointHandles}
    </g>
  )
}

function SupportAngleGuide({ item }) {
  const forward = item.x1 <= item.x2
  const first = forward ? { x: item.x1, y: item.y1 } : { x: item.x2, y: item.y2 }
  const second = forward ? { x: item.x2, y: item.y2 } : { x: item.x1, y: item.y1 }

  const dx = second.x - first.x
  const dy = second.y - first.y
  const length = Math.hypot(dx, dy) || 1
  const screenAngle = Math.atan2(dy, Math.max(0.0001, dx))
  const radius = Math.max(30, Math.min(58, length * 0.22)) //0.22是经验数值，弧线长度与角度的比，类似于残差之类的东西
  const arcStart = { x: first.x + radius, y: first.y }
  const arcEnd = { x: first.x + Math.cos(screenAngle) * radius, y: first.y + Math.sin(screenAngle) * radius }
  const labelAngle = screenAngle / 2
  const labelRadius = radius + 23
  const label = `${formatAngle(trackInclination(item))}°`

  let sweepFlag = 0
  if (screenAngle >= 0) sweepFlag = 1

  return (
    <g className="geometry-angle-guide" aria-label={`当前倾角${label}`}>
      <line className="geometry-guide-line" x1={first.x} y1={first.y} x2={first.x + radius + 28} y2={first.y} />
      <path className="geometry-guide-arc"
        d={`M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 0 ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`} />
      <AngleLabel x={first.x + Math.cos(labelAngle) * labelRadius} y={first.y + Math.sin(labelAngle) * labelRadius} text={label} />
    </g>
  )
}

function ArcAngleGuide({ item, start, end, annotation = {} }) {
  const fullCircle = item.fullCircle === true
  const sweep = arcSweepRadians(item.startAngle, item.endAngle, fullCircle)
  const guideRadius = Math.max(28, Math.min(58, item.radius * 0.42))

  let liveSweepDegrees = sweep * 180 / Math.PI
  if (fullCircle) liveSweepDegrees = 360

  const approx = annotation.estimated ? '≈' : ''
  const label = `${approx}${formatAngle(liveSweepDegrees)}°`

  if (fullCircle) {
    const labelY = item.cy - Math.max(42, Math.min(72, item.radius * 0.54))
    return (
      <g className="geometry-angle-guide arc-angle-guide" aria-label={`当前圆心角${label}`}>
        <circle className="geometry-center-point" cx={item.cx} cy={item.cy} r="4" />
        <AngleLabel x={item.cx} y={labelY} text={label} wide />
      </g>
    )
  }

  const guideStart = polar(item.cx, item.cy, guideRadius, item.startAngle)
  const guideEnd = polar(item.cx, item.cy, guideRadius, item.startAngle + sweep)
  const middle = item.startAngle + sweep / 2
  const labelPoint = polar(item.cx, item.cy, guideRadius + 25, middle)

  let arcPath = null
  if (sweep > 0.0001) {
    let largeArc = 0
    if (sweep > Math.PI) largeArc = 1
    arcPath = (
      <path className="geometry-guide-arc"
        d={`M ${guideStart.x} ${guideStart.y} A ${guideRadius} ${guideRadius} 0 ${largeArc} 1 ${guideEnd.x} ${guideEnd.y}`} />
    )
  }

  return (
    <g className="geometry-angle-guide arc-angle-guide" aria-label={`当前圆心角${label}`}>
      <line className="geometry-guide-line" x1={item.cx} y1={item.cy} x2={start.x} y2={start.y} />
      <line className="geometry-guide-line" x1={item.cx} y1={item.cy} x2={end.x} y2={end.y} />
      {arcPath}
      <circle className="geometry-center-point" cx={item.cx} cy={item.cy} r="4" />
      <AngleLabel x={labelPoint.x} y={labelPoint.y} text={label} wide />
    </g>
  )
}

// 主题
function saveTheme(dark) {
  const themeName = dark ? 'dark' : 'light'
  const themeColor = dark ? '#1c1c1e' : '#fbfcf8'
  try { window.localStorage.setItem(THEME_PREFERENCE_KEY, themeName) } catch {}
  try {
    document.querySelector?.('meta[name="theme-color"]')?.setAttribute('content', themeColor)
  } catch {}
}
