/** @jsxImportSource @revideo/2d/lib */
/**
 * Renders the storyboard: a title card, then for each beat a camera that moves
 * over a captured screenshot while a caption explains it, then a CLI card.
 *
 * Coordinates: Revideo puts (0, 0) at the centre of the frame. Screenshots are
 * placed on a "stage" node in their own CSS-pixel coordinates (top-left at the
 * stage origin), so a focus rectangle from the manifest can be outlined in the
 * same units it was measured in, and the camera is just the stage's scale and
 * position.
 */
import { Circle, Img, Node, Path, Rect, Txt, makeScene2D } from '@revideo/2d'
import {
  all,
  createRef,
  easeInOutCubic,
  easeOutCubic,
  sequence,
  useScene,
  Vector2,
  waitFor,
  type ThreadGenerator,
} from '@revideo/core'
import type { Manifest, Rect as Box, Shot } from '../manifest'
import { beats, intro, outro, type Beat, type Move, type Target } from './storyboard'

const FRAME = { width: 1920, height: 1080 }
/** Space the caption occupies at the bottom; the camera centres above it. */
const CAPTION_CLEARANCE = 170
const COLOR = {
  night: '#0b1020',
  ink: '#0f172a',
  accent: '#3b82f6',
  amber: '#f59e0b',
  white: '#ffffff',
  muted: '#94a3b8',
}
const SANS = 'Inter, "DejaVu Sans", sans-serif'
const MONO = '"JetBrains Mono", "DejaVu Sans Mono", monospace'
const MAX_ZOOM = 2.4

interface Camera {
  scale: number
  position: Vector2
}

function cameraFor(shot: Shot, target: Target): Camera {
  const { width: w, height: h } = shot.size
  const fitWidth = FRAME.width / w

  if (target === 'full' || target === 'top') {
    const scale = target === 'top' ? fitWidth : Math.min(fitWidth, FRAME.height / h)
    const x = -(w * scale) / 2
    const y = target === 'top' || h * scale > FRAME.height ? -FRAME.height / 2 : -(h * scale) / 2
    return { scale, position: new Vector2(x, y) }
  }

  const box = shot.focus[target.focus]
  if (!box) throw new Error(`Storyboard: shot "${shot.id}" has no focus region "${target.focus}"`)
  const room = { width: FRAME.width * 0.86, height: (FRAME.height - CAPTION_CLEARANCE) * 0.86 }
  const fit = Math.min(room.width / (box.width * fitWidth), room.height / (box.height * fitWidth))
  const zoom = Math.max(1, Math.min(target.zoom ?? MAX_ZOOM, fit))
  const scale = fitWidth * zoom
  const centre = new Vector2(box.x + box.width / 2, box.y + box.height / 2)
  let position = new Vector2(0, -CAPTION_CLEARANCE / 2).sub(centre.scale(scale))
  // Keep the picture covering the frame: never show past its edges.
  const clamp = (value: number, size: number, frame: number) =>
    size <= frame ? -size / 2 : Math.min(-frame / 2, Math.max(frame / 2 - size, value))
  position = new Vector2(
    clamp(position.x, w * scale, FRAME.width),
    clamp(position.y, h * scale, FRAME.height)
  )
  return { scale, position }
}

function outline(box: Box, stageScale: number): Node {
  const pad = 10 / stageScale
  return (
    <Rect
      position={[box.x + box.width / 2, box.y + box.height / 2]}
      width={box.width + pad * 2}
      height={box.height + pad * 2}
      radius={12 / stageScale}
      stroke={COLOR.amber}
      lineWidth={5 / stageScale}
      fill={'rgba(245, 158, 11, 0.07)'}
      opacity={0}
      shadowColor={'rgba(245, 158, 11, 0.45)'}
      shadowBlur={24}
    />
  ) as Node
}

/** A classic arrow pointer, drawn in CSS pixels so it zooms with the page. */
function pointerArrow(): Path {
  return (
    <Path
      data="M0 0 L0 24 L6.5 18.5 L10.5 27.5 L14.5 25.8 L10.6 17 L18 17 Z"
      fill={COLOR.white}
      stroke={COLOR.ink}
      lineWidth={1.6}
      opacity={0}
      shadowColor={'rgba(0,0,0,0.35)'}
      shadowBlur={6}
      shadowOffset={[1, 2]}
    />
  ) as Path
}

function caption(view: Node, index: number, beat: Beat): Rect {
  const card = createRef<Rect>()
  view.add(
    <Rect
      ref={card}
      layout
      direction={'column'}
      gap={10}
      padding={[26, 40]}
      width={FRAME.width - 160}
      y={FRAME.height / 2 - 100}
      offset={[0, 0]}
      radius={20}
      fill={'rgba(11, 16, 32, 0.9)'}
      shadowColor={'rgba(0,0,0,0.35)'}
      shadowBlur={30}
      opacity={0}
    >
      <Txt
        text={`${String(index + 1).padStart(2, '0')}  ·  ${beat.chapter.toUpperCase()}`}
        fontFamily={SANS}
        fontWeight={700}
        fontSize={24}
        letterSpacing={2}
        fill={COLOR.amber}
      />
      <Txt text={beat.caption} fontFamily={SANS} fontSize={36} lineHeight={48} fill={COLOR.white} textWrap />
    </Rect>
  )
  return card()
}

function* playBeat(view: Node, manifest: Manifest, index: number, beat: Beat): ThreadGenerator {
  const shot = manifest.shots[beat.shot]
  if (!shot) throw new Error(`Storyboard: no captured shot "${beat.shot}"`)

  const stage = createRef<Node>()
  const first = cameraFor(shot, beat.moves[0]?.to ?? 'full')
  view.add(
    <Node ref={stage} scale={first.scale} position={first.position} opacity={0}>
      <Img src={`/out/shots/${shot.file}`} width={shot.size.width} height={shot.size.height} offset={[-1, -1]} />
    </Node>
  )

  const captionCard = caption(view, index, beat)
  yield* all(stage().opacity(1, 0.5), captionCard.opacity(1, 0.5, easeOutCubic))

  const arrow = pointerArrow()
  stage().add(arrow)

  for (const move of beat.moves) {
    yield* playMove(stage(), shot, move, arrow)
  }

  yield* all(stage().opacity(0, 0.45), captionCard.opacity(0, 0.35))
  stage().remove()
  captionCard.remove()
}

function* playMove(stage: Node, shot: Shot, move: Move, arrow: Path): ThreadGenerator {
  const camera = cameraFor(shot, move.to)
  const travel = move.travel ?? 1
  if (travel > 0) {
    yield* all(stage.scale(camera.scale, travel, easeInOutCubic), stage.position(camera.position, travel, easeInOutCubic))
  } else {
    stage.scale(camera.scale)
    stage.position(camera.position)
  }

  const outlines = (move.highlight ?? []).map((name) => {
    const box = shot.focus[name]
    if (!box) throw new Error(`Storyboard: shot "${shot.id}" has no focus region "${name}"`)
    const node = outline(box, camera.scale)
    stage.add(node)
    return node
  })

  const pointerThread = function* (): ThreadGenerator {
    if (!move.pointer || !shot.pointer) return
    const target = new Vector2(shot.pointer.x, shot.pointer.y)
    arrow.position(target.add([140, 90]))
    arrow.moveToTop()
    yield* all(arrow.opacity(1, 0.25), arrow.position(target, 0.9, easeInOutCubic))
    if (move.pointer === 'click') {
      const ripple = (<Circle position={target} size={0} stroke={COLOR.amber} lineWidth={3} opacity={0.9} />) as Circle
      stage.add(ripple)
      arrow.moveToTop()
      yield* all(ripple.size(56, 0.5, easeOutCubic), ripple.opacity(0, 0.5))
      ripple.remove()
    }
  }

  yield* all(
    sequence(0.15, ...outlines.map((node) => node.opacity(1, 0.35))),
    pointerThread(),
    waitFor(move.hold)
  )
  yield* all(...outlines.map((node) => node.opacity(0, 0.25)), arrow.opacity(0, 0.2))
  outlines.forEach((node) => node.remove())
}

function* titleCard(view: Node): ThreadGenerator {
  const group = createRef<Node>()
  view.add(
    <Node ref={group} opacity={0}>
      <Txt text={intro.title} y={-90} fontFamily={SANS} fontWeight={800} fontSize={150} fill={COLOR.white} letterSpacing={-3} />
      <Rect y={10} width={120} height={6} radius={3} fill={COLOR.amber} />
      <Txt text={intro.subtitle} y={80} fontFamily={SANS} fontWeight={500} fontSize={52} fill={COLOR.white} />
      <Txt text={intro.premise} y={170} fontFamily={SANS} fontSize={30} fill={COLOR.muted} />
    </Node>
  )
  yield* group().opacity(1, 0.7)
  yield* waitFor(2.6)
  yield* group().opacity(0, 0.5)
  group().remove()
}

function* cliCard(view: Node): ThreadGenerator {
  const group = createRef<Node>()
  const lines = createRef<Node>()
  const lineHeight = 74
  const top = -((outro.commands.length - 1) * lineHeight) / 2 + 60
  view.add(
    <Node ref={group} opacity={0}>
      <Txt text={outro.title} y={-330} fontFamily={SANS} fontWeight={800} fontSize={84} fill={COLOR.white} />
      <Txt text={outro.caption} y={-240} fontFamily={SANS} fontSize={34} fill={COLOR.muted} />
      <Rect y={60} width={1460} height={outro.commands.length * lineHeight + 80} radius={24} fill={'#111a33'} stroke={'#24304f'} lineWidth={2} />
      <Node ref={lines} />
    </Node>
  )
  outro.commands.forEach((line, i) => {
    lines().add(
      <Node y={top + i * lineHeight} opacity={0}>
        <Txt text={'$'} x={-680} offset={[-1, 0]} fontFamily={MONO} fontSize={32} fill={COLOR.amber} />
        <Txt text={line.cmd} x={-640} offset={[-1, 0]} fontFamily={MONO} fontSize={32} fill={COLOR.white} />
        <Txt text={line.note ? `# ${line.note}` : ''} x={680} offset={[1, 0]} fontFamily={MONO} fontSize={26} fill={COLOR.muted} />
      </Node>
    )
  })
  yield* group().opacity(1, 0.5)
  yield* sequence(0.35, ...lines().children().map((n) => n.opacity(1, 0.3)))
  yield* waitFor(3.2)
  yield* group().opacity(0, 0.6)
}

export default makeScene2D('walkthrough', function* (view) {
  const manifest = useScene().variables.get<Manifest | null>('manifest', null)()
  if (!manifest) throw new Error('The walkthrough needs the capture manifest as the "manifest" variable')

  // Canvas text does not wait for web fonts, so load them before the first frame.
  yield Promise.all(
    ['400 36px Inter', '500 52px Inter', '700 24px Inter', '800 150px Inter', '400 32px "JetBrains Mono"'].map((font) =>
      document.fonts.load(font)
    )
  )

  view.add(<Rect width={FRAME.width} height={FRAME.height} fill={COLOR.night} />)

  yield* titleCard(view)
  for (const [index, beat] of beats.entries()) {
    yield* playBeat(view, manifest, index, beat)
  }
  yield* cliCard(view)
})
