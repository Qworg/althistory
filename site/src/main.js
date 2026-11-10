/* ------------------------------------------------------- hero timeline --- */
// Each event in the drawing carries its date, text and actors (site/build.mjs).
// Point at one, tap near one, or focus the timeline and use the arrow keys:
// a card names it and offers to open its history in the demo, and the events
// it led to stay lit while the rest fades. Keyboard selections are also read
// out through a live region; Tab from the timeline reaches the card's link.

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

  // On a narrow screen the timeline scrolls sideways; start it with the fork
  // just inside the left edge, where no label is cut (the 1843 label, the
  // only one that would be, is not drawn on phones).
  if (scrollable()) {
    const fork = Number(svg.dataset.forkX) * scroller.scrollWidth
    scroller.scrollLeft = Math.max(0, fork - 64)
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

    const position = hit.dataset.pos ?? `${i + 1} of ${hits.length}`
    const led = branch
      ? `Only in the branch ${hit.dataset.graph}. Select an event before 1860 to trace what it caused.`
      : events.size
        ? `Led to ${events.size} later event${events.size === 1 ? '' : 's'}`
        : 'Led to nothing later in this history'
    const open = document.createElement('a')
    open.className = 'ht-open'
    open.href = `demo/?start=${hit.dataset.start ?? 'branch'}`
    open.textContent = `Open ${hit.dataset.graph ?? 'this history'} in the demo`
    tip.replaceChildren(
      line('ht-tip-date', `${hit.dataset.date ?? ''} · ${position}`),
      line('ht-tip-text', hit.dataset.text ?? ''),
      line('ht-tip-who', hit.dataset.who ?? ''),
      line('ht-tip-led', led),
      open
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
      live.textContent = `${position}. ${hit.dataset.date}: ${hit.dataset.text}. ${hit.dataset.who}. ${led}.`
    }
  }

  // A mouse leaving an event waits a moment before the card goes, so the
  // pointer can travel onto the card's link.
  let hideTimer = 0
  const hideSoon = () => {
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => hide(), 260)
  }
  const keep = () => window.clearTimeout(hideTimer)

  const hide = () => {
    window.clearTimeout(hideTimer)
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
    if (i >= 0) {
      keep()
      if (i !== active) show(i)
    } else if (active >= 0 && !scroller.contains(document.activeElement)) {
      hideSoon()
    }
  })
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !scroller.contains(document.activeElement)) hideSoon()
  })
  tip.addEventListener('pointerenter', keep)
  tip.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !scroller.contains(document.activeElement)) hideSoon()
  })
  svg.addEventListener('click', (event) => {
    // A finger is wider than a dot: take the nearest event within reach.
    const i = nearest(event, event.pointerType === 'mouse' ? 16 : 40 / Math.max(scale(), 0.5))
    if (i < 0) return hide()
    if (i === active && event.pointerType === 'mouse') return
    show(i, { reveal: true })
  })
  document.addEventListener('click', (event) => {
    if (!svg.contains(event.target) && !tip.contains(event.target)) hide()
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
  // Tabbing from the timeline onto the card's link keeps the card.
  scroller.addEventListener('focusout', (event) => {
    if (!scroller.contains(event.relatedTarget)) hide()
  })
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
  const begin = () => {
    start()
    video.focus()
    video.play().catch(() => undefined)
  }
  play.addEventListener('click', begin)
  // On a phone the button sits under the poster; the poster plays too.
  video.addEventListener('click', () => {
    if (!video.controls) begin()
  })
  video.addEventListener('play', start)
}

/* -------------------------------------------------------------- closing --- */
// The closing band's fork draws itself as it comes into view, as the hero's
// did. Without the script, or with reduced motion, it is simply there.

const closingFork = document.querySelector('.closing-fork')
if (
  closingFork &&
  'IntersectionObserver' in window &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches
) {
  closingFork.classList.add('will-draw')
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        closingFork.classList.add('is-drawn')
        observer.disconnect()
      }
    },
    { threshold: 0.6 }
  )
  observer.observe(closingFork)
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
