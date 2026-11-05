// @tangent/motion public surface. Framework-agnostic: no React, no Tauri, no app code.
export * from "./dsl/schema";
export { validateScene, type DslError } from "./dsl/validate";
export { compile, resolveAnchor, type Timeline, type TimelineEvent, type Word, type BeatAudio } from "./dsl/compile";
export { compileOps, expandOp } from "./dsl/ops";
export { expandTemplates, TEMPLATES, VARIANTS, TEMPLATE_GUIDE, TemplateScene, type TemplateName } from "./dsl/templates";
export { applyEventsAt, type SceneState, type ObjState } from "./stage/scene";
export { SceneRenderer } from "./stage/renderer";
export { Player, type Clock } from "./player/player";
export { SceneQueue, beatStarts, resumeTime } from "./player/queue";
export { Annotation, checkAnnotations } from "./annotations";
