# Workspace design guidelines

Material Motion Lab is a video inspection and measurement workspace. Video, time and measured motion are the main content. The layout must support repeated work without requiring people to scroll through a form to operate it.

These are project design rules, informed by the Material sources below. The workspace arrangement, control placement and defaults are our decisions. Source recommendations remain distinct from those decisions.

## Design the task before placing controls

For each feature, identify its subject, frequency, scope and state:

- Subject: the workspace, a video, a tracking range, a reference or an export.
- Frequency: continuous use, occasional adjustment or a separate task.
- Scope: what changes, and where the result must remain visible.
- State: what is selected, available, running, complete or invalid.

Choose the location and component from those answers. Do not append a feature to whichever sidebar already exists. Do not treat three broad layout regions as three categories that must hold every control.

Persistent operations stay near the content they affect. Occasional settings have a visible, named opener. Separate tasks open a dedicated surface. Removing a poor disclosure affordance does not justify exposing every setting permanently.

## Give the working content the space

Use an adaptive scaffold with optional supporting panes around a flexible workspace. Within the workspace, viewers, timeline and chart are working regions with their own controls. They do not each require a new app destination or a card.

The project library lists analyses; each project contains up to two videos. It is not a reason to keep a wide navigation drawer open throughout editing. Use navigation components for real destinations and toolbars for tools. Do not invent destinations to fill a navigation rail or bar.

The shared Token Catalog navigation uses a persistent drawer on wide screens
and a modal drawer on narrow screens, with the site footer below the editor. These use `forge/site/` from the sibling Tokens checkout. There is no separate app title bar or app navigation rail. Project, Import and Export form a floating toolbar above the permanent tools panel, in the same column. Tracking, Alignment and Chart live in a permanent tools panel as independent accordion sections. The panel has no opener, dismiss button or modal state. It docks beside the workspace at widths of 1000px and above, with a resizable divider. Below 1000px, hide that column and use a floating bottom toolbar with Project, Tracking, Alignment, Chart and Export. The Project menu contains Import video, New project, Open project and Save; the other actions open anchored menus, with submenus for choices and individual numeric values. Do not open a side sheet or full-screen menu. Desktop export configuration remains in its dialog.

The timeline and chart share time, selection and playhead state. Their controls remain close enough to make this relationship visible. Changing one region must not force the user to find the corresponding state in a distant form.

## Choose the right surface

| Interaction | Presentation | Material Motion Lab application |
| --- | --- | --- |
| Repeated commands | Toolbar or standard button group | Playback, frame stepping, drawing and correction tools |
| Mutually exclusive choices | Connected button group, tabs or a selection menu | Position/progress modes, inspector sections, reference presets |
| Small sets of commands | Menu | Import/export formats and infrequent commands |
| Live settings that need the video or chart visible | Contextual inspector or non-modal side sheet | Tracking parameters, alignment and custom reference parameters |
| A bounded task with a final action | Dialog; full-screen task on compact windows when needed | Export interval, format, annotations and export preview |
| Supplementary status | Inline status or snackbar | Tracking completion and export completion |
| Explanation of an unfamiliar control | Tooltip or concise supporting text | Search radius and tracking score |

A menu is not a form container. Use a settings surface for several fields. A dialog is not the default home for every option: live tuning must leave the affected content usable. Every temporary surface needs a clear opener, title and close action.

## Establish action hierarchy

Choose a prominent action for the current task. Use the shared filled or tonal variant where emphasis is warranted; use standard icon buttons, text buttons and outlined buttons for their appropriate secondary roles. Do not render every action as the same outlined pill.

Play/pause and previous/next frame belong in one standard button group within the transport toolbar. Use a consistent size and shape, with play/pause visually prominent. Keep timecode, playback speed and loop nearby as distinct controls. Previous and next are commands, not selected options. Do not give the transport a radio-group interaction model.

Use standard groups for paired commands and connected groups for selectable options such as Pixels/Progress. Only selection buttons use persistent pressed state. Preserve selected, pressed, hovered, focused, disabled and busy states from the shared primitives. A dark outline is not a substitute for a selected state.

The empty workspace uses a medium filled Import video button and a small tonal Open example button. The inspector uses a small filled Draw region button, small tonal Track/Correct actions and a standard tonal Set start/Set end group. Seeking and tracking-mark navigation use small standard text-button groups. Pan and expand controls retain the outlined toggle family. The desktop toolbar uses extra-small controls; primary task actions retain their larger official sizes.

Overflow contains less frequent commands. It must not hide the action needed to begin the current task. Group related commands and separate unrelated sets with the actual menu divider primitive.

## Reveal settings deliberately

The default workspace shows the current result and the controls needed for the next useful action. It does not show every possible configuration.

Show a compact summary of active settings with an explicit control such as **Tracking settings**, **Reference settings** or **Export**. Use a settings icon with an accessible name where space is limited. Do not make an understated disclosure triangle the only clue that essential controls exist.

Keep an opened settings surface in place while the user adjusts it. Preserve values when it closes. Closing settings does not turn off the setting. Show active effects, selected references and pending changes in the relevant toolbar or result view.

Use optional advanced sections inside an already open task when necessary. Do not collapse the entire task behind an ambiguous “more information” affordance.

## Make panes adjustable

Provide visible splitters between regions that compete for working space. Users can resize the viewer/chart division and inspector width. The scrub area fits its toolbar and tracks and has no height resize control. Tracks fill the available workspace width, with compact controls in narrow panes. The inspector starts at 480px, can shrink to 320px, and can grow while leaving at least 360px for the workspace. Below 1000px, the mobile toolbar and menus replace that column. The loaded viewer retains a 180px minimum height, the library retains 240px, and the chart canvas retains 260px. The workspace scrolls when the combined pane minimums exceed the window height.

Splitters need hover, focus and dragging feedback; suitable pointer cursors; keyboard resizing; and a non-drag way to collapse or restore a pane. Set minimum usable dimensions so labels, fields and actions remain legible.

Remember pane sizes. Open recordings with the viewer visible and contextual settings closed. Do not restore maximization as the initial view. Clamp restored dimensions to the available window rather than restoring unusable sizes. Provide keyboard size reset on splitters and a way to maximize the viewer or chart and restore the previous arrangement. Hiding a pane must not discard its data or settings.

Resizing a pane changes its available content area. It must not enlarge all controls, stretch icon buttons or crop a video that is in Fit mode. Video zoom, timeline zoom and chart scale remain separate operations.

## Use color, typography and elevation for meaning

Use the actual Token Catalog tokens and components. App CSS owns layout; shared primitives own component geometry, typography and interaction states. Inspect a primitive before adding an override. If its behavior is missing or wrong, address that shared implementation instead of drawing an imitation.

Use semantic surface roles to distinguish the application background, working content and supporting tools. Start with `surface` for the workspace background and `surface-container` for navigation/supporting regions. Choose additional container roles only where a meaningful boundary needs them. Keep role assignments consistent across breakpoints and light/dark themes.

Use primary emphasis for the current important action and active tools. Preserve the component's selected-state mappings. Use paired on-colors for text and icons. Give video A and B consistent trace keys across the viewer, timeline, chart and readouts, reinforced with labels and line styles.

Use elevation when a surface sits above another or the component requires it. Flat panes can be separated through surface color, spacing and an appropriate divider. Rounded corners do not imply a card, and a card does not automatically imply a shadow. Use component elevation tokens rather than a blanket shadow or a custom surface tint.

Use the shared label and body type styles for controls. Pane titles, field labels, values and secondary status need distinct roles. Use tabular numerals for timecodes and measurements. Do not shrink text to fit a panel that should be wider or differently arranged.

## Use density to improve work

Remove redundant captions, repeated instructions and excessive gaps before reducing component sizes. Put related controls in compact rows and toolbars. Preserve space for the video and plot rather than stretching their settings across the window.

Use the shared spacing scale. Keep gaps within a group smaller than gaps between groups. Align fields and labels to consistent pane edges. Use containment where it explains a relationship; do not surround every group with another card.

Keep accessible targets even when icons are visually small. Material's density guidance specifies 48 × 48 CSS px default targets. An optional denser layout must be reversible through accessible controls and must not reduce text size. Do not globally scale components down or force desktop density onto touch users.

The editor should fit the available window height in normal desktop use. Viewers and charts resize; bins and inspectors scroll internally where needed. A long page of settings must not push transport controls or the chart off-screen. Compact layouts can scroll when that preserves usable content and targets.

## Adapt the arrangement

Use available window space, including height, rather than a device-name check. These are initial project layouts, not a requirement to display a particular pane count:

| Window width in CSS px | Arrangement |
| --- | --- |
| Under 600 | One main working view. Open media and settings through explicit controls. Use sheets or full-screen tasks when necessary. Keep transport reachable and respect safe areas. |
| 600–839 | Prioritize one workspace. Open supporting tools on demand instead of squeezing two dense panes together. |
| 840–1199 | Keep the workspace flexible. Show a supporting inspector when its minimum width and the working content both fit; otherwise use a temporary surface. |
| 1200–1599 | Dock the inspector only when the workspace retains enough width; otherwise open it as a modal sheet. |
| 1600 and above | Allow the workspace and contextual inspector together. Extra width does not reveal additional settings automatically. |

The thresholds come from Material's breakpoint ranges, applied to web CSS pixels. Short windows can still require a single-work-area arrangement. Browser zoom, text scaling and resized panes must not produce clipped labels or unreachable commands.

Keep selected video, time, tracking range, alignment and settings when the arrangement changes. Do not add navigation destinations or reset density to accommodate a breakpoint. A modal surface traps focus and restores it to its trigger; a non-modal inspector permits movement between tools and content.

## Apply this to Material Motion Lab

| Area | Default contents | Controls opened when needed |
| --- | --- | --- |
| Workspace actions | Floating toolbar with Project, Import and Export; Save in the Project menu | File picker, Export dialog and portable project download |
| Empty workspace | Import action, example project and recent projects; empty timeline/chart | File picker |
| Viewer | Video, A/B identity, active selection, local zoom | Tracking tool choices and overlays |
| Transport | Standard playback button group, timecode, speed, loop | Less frequent playback commands |
| Timeline | Shared ruler, playhead, playback interval, tracking ranges and alignment markers | Precise range entry and alignment settings |
| Permanent tools panel | Tracking, Alignment and Chart accordions | Each section's controls |
| Chart | Traces, axes, legend, current values and concise result | Reference editor, exact scale and chart display settings |
| Export task | Format, source/range summary, interval, annotation options, preview and Export/Cancel | Format-specific options |

Alignment is part of comparing videos and stays available during that work. It is not placed after a long export form. Export settings appear only after opening Export. Reference editing stays visibly connected to the chart and keeps that chart usable.

When no corrections or tracking losses exist, keep the Tracking marks section and its actions visible but disabled. Disable its menu entry when none of its actions is available. When tracking has not started, expose selection and tracking actions; do not fill the workspace with unavailable result commands. Show progress and cancellation for a running job, and put failures beside the affected task.

## Review before shipping

Before implementation, describe the default view, each temporary surface and each state that changes the available actions. Review the composition as a whole before adding controls.

A change is ready for visual review when:

- Video, transport, timeline and chart remain usable at a normal desktop viewport without browser zooming out.
- The current selection, active tool and primary action are clear without reading every label.
- Related commands form real groups; independent options retain their correct semantics.
- Export is reachable and its form is absent until opened.
- Live reference and tracking adjustments leave their affected content visible.
- Pane resizing, collapse, restore and layout reset work with pointer and keyboard input.
- Empty, selected, busy, complete, failed and tracking-lost states have been checked.
- Labels remain readable at narrow widths and with text scaling; touch targets and focus remain usable.
- Both single-video and comparison layouts preserve time, alignment and range state.

Automated tests should verify state, geometry and interactions. Inspect the real rendered workspace at normal scale as well. Passing isolated component tests does not establish a coherent layout.

## Material sources

Reviewed from the rendered pages on 2026-10-26. These sources inform the rules above; they do not specify Material Motion Lab's exact arrangement.

- [Layout overview](https://m3.material.io/foundations/layout/layout-overview/overview), [parts of layout](https://m3.material.io/foundations/layout/layout-overview/parts-of-layout), [adaptive design](https://m3.material.io/foundations/layout/layout-overview/adaptive-design).
- [Scaffold overview](https://m3.material.io/foundations/layout/scaffold/overview), [bars](https://m3.material.io/foundations/layout/scaffold/bars), [rails](https://m3.material.io/foundations/layout/scaffold/rails), [panes](https://m3.material.io/foundations/layout/scaffold/panes).
- [Grids and spacing overview](https://m3.material.io/foundations/layout/grids-spacing/overview), [grids](https://m3.material.io/foundations/layout/grids-spacing/grids), [spacing](https://m3.material.io/foundations/layout/grids-spacing/spacing), [density](https://m3.material.io/foundations/layout/grids-spacing/density).
- [Breakpoint overview](https://m3.material.io/foundations/layout/breakpoints/overview), [compact](https://m3.material.io/foundations/layout/breakpoints/compact), [medium](https://m3.material.io/foundations/layout/breakpoints/medium), [expanded](https://m3.material.io/foundations/layout/breakpoints/expanded), [large and extra-large](https://m3.material.io/foundations/layout/breakpoints/large-extra-large).
- [Color roles](https://m3.material.io/styles/color/roles), [elevation tokens](https://m3.material.io/styles/elevation/tokens).
- [Button groups](https://m3.material.io/components/button-groups/guidelines), [toolbars](https://m3.material.io/components/toolbars/overview), [side sheets](https://m3.material.io/components/side-sheets/guidelines), [dialogs](https://m3.material.io/components/dialogs/guidelines).

## Screen states

The workspace remains visible without a video. Its viewer panel shows Import video, the example project and recent projects directly. The timeline and plot have no data, and dependent controls are unavailable. Import video opens the file picker directly. There is no video chooser dialog, separate entry screen or exit destination.

The editor separates viewer, timeline and chart with working surfaces and gutters. Viewer labels identify the recordings. Project, Import and Export form a floating toolbar in the same column as the tools panel. The permanent tools panel uses independently expandable sections. It docks on the right when space permits; narrow screens use the bottom toolbar and anchored menus.

Ordinary workspace commands use neutral text-button label and icon tokens. Do not give individual one-shot commands tonal styling to imply selection. Reserve persistent selected styling for modes, and primary emphasis for the main run/play actions. Expand/Restore and Pan use shared outlined toggle variants in both states; aria-pressed selects their appearance without switching button variants.

Use video for media and workspace for the current analysis view. A project owns its name, video tracks and workspace state independently of its videos. A project file is a portable `.motion` archive containing the videos, measurements and workspace state. Save downloads that file; Open project in the Project menu restores it. Import video adds video A, then video B. When both slots are occupied, ask which video to replace. The project identity survives video replacement and removal. New project creates an empty project; Open project restores another project. Wait for automatic browser saves when switching projects. Offer portable project downloads separately; warn on closing the page only while processing or saving, or after a local-save failure. The project menu remains available in occupied and empty workspaces.

Reference duration uses Manual, Auto-fit A or Auto-fit B. Auto-fit remains selected and recalculates against the selected video when the curve, measurement axis, range or tracking data changes. Its status shows the computed duration, updating state or why fitting is unavailable. Spring references use physical time and do not offer duration fitting.

## Local project ownership

The web app stores projects and videos in this browser and processes media in workers. Save project file downloads a portable archive; it is separate from automatic local saves. Reopening the bundled example reuses its local project. Make a copy is explicit. Deleting a project removes only its unshared media and frames; it does not affect downloaded project files. The deployed tool consists of static files and exposes no upload or processing endpoints.
