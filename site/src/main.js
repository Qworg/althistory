/* ------------------------------------------------------- hero timeline --- */
// Each event in the drawing carries its date, text and actors (site/build.mjs).
// Point at one, tap near one, or focus the timeline and use the arrow keys:
// a card names it, and the events it led to stay lit while the rest fades.
// Keyboard selections are also read out through a live region.

const figure = document.querySelector('.hero-figure')
const scroller = figure?.querySelector('.hero-scroll')
const canvas = figure?.querySelector('.hero-canvas')
const svg = canvas?.querySelector('svg.hero-timeline')
const tip = canvas?.querySelector('.ht-tip')
const live = figure?.querySelector('.ht-live')

if (figure && scroller && canvas && svg && tip) {
  const hits = [...svg.querySelectorAll('.ht-hit')]
  const ring = svg.querySelector('.ht-ring')
  const links = [...svg.querySelectorAll('.ht-link')]
  const dots = new Map([...svg.querySelectorAll('.ht-event[data-key]')].map((dot) => [dot.dataset.key, dot]))
  const point = (hit) => ({ x: Number(hit.getAttribute('cx')), y: Number(hit.getAttribute('cy')) })
  let active = -1

  // What each event led to, following the causal links forward.
  const effectsOf = new Map()
  for (const link of links) {
    const list = effectsOf.get(link.dataset.from) ?? []
    list.push(link)
    effectsOf.set(link.dataset.from, list)
  }
  const downstream = (key) => {
    const events = new Set()
    const lit = new Set()
    const queue = [key]
    while (queue.length) {
      for (const link of effectsOf.get(queue.shift()) ?? []) {
        lit.add(link)
        if (!events.has(link.dataset.to)) {
          events.add(link.dataset.to)
          queue.push(link.dataset.to)
        }
      }
    }
    return { events, links: lit }
  }

  const scrollable = () => scroller.scrollWidth > scroller.clientWidth + 1
  const fit = () => figure.classList.toggle('is-scrollable', scrollable())
  fit()

  // On a narrow screen the timeline scrolls sideways; start it at the fork.
  if (scrollable()) {
    const fork = Number(svg.dataset.forkX) * scroller.scrollWidth
    scroller.scrollLeft = Math.max(0, fork - scroller.clientWidth * 0.25)
  }

  const line = (cls, text) => {
    const span = document.createElement('span')
    span.className = cls
    span.textContent = text
    return span
  }

  const scale = () => svg.getBoundingClientRect().width / svg.viewBox.baseVal.width

  // Keep the card over its event, inside the part of the drawing on screen.
  const place = () => {
    const hit = hits[active]
    if (!hit) return
    const { x, y } = point(hit)
    const px = x * scale()
    const half = tip.offsetWidth / 2
    const from = scroller.scrollLeft + half + 4
    const to = scroller.scrollLeft + scroller.clientWidth - half - 4
    tip.style.left = `${Math.min(Math.max(px, from), Math.max(from, to))}px`
    tip.style.top = `${y * scale()}px`
  }

  const show = (i, { reveal = false, announce = false } = {}) => {
    const hit = hits[i]
    if (!hit) return
    active = i
    const { x, y } = point(hit)
    const branch = hit.hasAttribute('data-branch')
    ring?.setAttribute('cx', String(x))
    ring?.setAttribute('cy', String(y))
    ring?.classList.add('is-on')
    ring?.classList.toggle('is-branch', branch)

    // Light what it led to.
    const { events, links: lit } = downstream(hit.dataset.key)
    svg.classList.toggle('is-tracing', !branch)
    for (const link of links) link.classList.toggle('is-lit', lit.has(link))
    for (const [key, dot] of dots) dot.classList.toggle('is-lit', key === hit.dataset.key || events.has(key))

    const position = `${i + 1} of ${hits.length}`
    const led = !branch && events.size ? `Led to ${events.size} later event${events.size === 1 ? '' : 's'}` : ''
    tip.replaceChildren(
      line('ht-tip-date', `${hit.dataset.date ?? ''} · ${position}`),
      line('ht-tip-text', hit.dataset.text ?? ''),
      line('ht-tip-who', hit.dataset.who ?? ''),
      ...(led ? [line('ht-tip-led', led)] : [])
    )
    tip.classList.toggle('is-branch', branch)
    tip.classList.add('is-on')

    if (reveal && scrollable()) {
      const px = x * scale()
      const edge = 56
      if (px < scroller.scrollLeft + edge || px > scroller.scrollLeft + scroller.clientWidth - edge) {
        scroller.scrollTo({ left: px - scroller.clientWidth / 2 })
      }
    }
    place()
    if (announce && live) {
      live.textContent = `${position}. ${hit.dataset.date}: ${hit.dataset.text}. ${hit.dataset.who}.${led ? ` ${led}.` : ''}`
    }
  }

  const hide = () => {
    active = -1
    ring?.classList.remove('is-on')
    tip.classList.remove('is-on')
    svg.classList.remove('is-tracing')
  }

  // The event nearest a pointer, within reach (in drawing units).
  const nearest = (event, reach) => {
    const box = svg.getBoundingClientRect()
    const s = scale()
    const x = (event.clientX - box.left) / s
    const y = (event.clientY - box.top) / s
    let best = -1
    let bestDistance = reach
    hits.forEach((hit, i) => {
      const p = point(hit)
      const distance = Math.hypot(p.x - x, (p.y - y) * 1.5)
      if (distance < bestDistance) {
        best = i
        bestDistance = distance
      }
    })
    return best
  }

  svg.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return
    const i = nearest(event, 16)
    if (i >= 0 && i !== active) show(i)
    else if (i < 0 && active >= 0 && document.activeElement !== scroller) hide()
  })
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && document.activeElement !== scroller) hide()
  })
  svg.addEventListener('click', (event) => {
    // A finger is wider than a dot: take the nearest event within reach.
    const i = nearest(event, event.pointerType === 'mouse' ? 16 : 40 / Math.max(scale(), 0.5))
    if (i < 0) return hide()
    if (i === active && event.pointerType === 'mouse') return
    show(i, { reveal: true })
  })
  document.addEventListener('click', (event) => {
    if (!svg.contains(event.target)) hide()
  })

  scroller.addEventListener('keydown', (event) => {
    const last = hits.length - 1
    const next = {
      ArrowRight: active < 0 ? 0 : Math.min(last, active + 1),
      ArrowLeft: active < 0 ? last : Math.max(0, active - 1),
      Home: 0,
      End: last,
    }[event.key]
    if (next !== undefined) {
      event.preventDefault()
      show(next, { reveal: true, announce: true })
    } else if (event.key === 'Escape') {
      hide()
    }
  })
  scroller.addEventListener('blur', hide)
  scroller.addEventListener('scroll', place, { passive: true })
  window.addEventListener('resize', () => {
    fit()
    place()
  })
}

/* ---------------------------------------------------------- walkthrough --- */
// The native controls sit on top of the poster's caption bar, so until the
// tour plays the poster shows only a play button. Without this script the
// video keeps its controls.

const video = document.querySelector('.player video')
const play = document.querySelector('.player .play')
if (video && play) {
  video.controls = false
  play.hidden = false
  const start = () => {
    play.hidden = true
    video.controls = true
  }
  play.addEventListener('click', () => {
    start()
    video.focus()
    video.play().catch(() => undefined)
  })
  video.addEventListener('play', start)
}

/* ---------------------------------------------------------- quick start --- */

for (const button of document.querySelectorAll('button[data-copy]')) {
  if (!navigator.clipboard) {
    button.hidden = true
    continue
  }
  // The label is read once: a second click inside 1.8 s would otherwise
  // take "Copied" for it and keep it.
  const label = button.textContent
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select the text to copy'
    }
    setTimeout(() => (button.textContent = label), 1800)
  })
}
