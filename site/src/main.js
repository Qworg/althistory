/* ------------------------------------------------------- hero timeline --- */
// Each event in the drawing carries its date, text and actors (site/build.mjs).
// Point at one, tap it, or focus the timeline and use the arrow keys, and a
// card names it; the card is a live region, so a screen reader reads it too.

const figure = document.querySelector('.hero-figure')
const scroller = figure?.querySelector('.hero-scroll')
const canvas = figure?.querySelector('.hero-canvas')
const svg = canvas?.querySelector('svg.hero-timeline')
const tip = canvas?.querySelector('.ht-tip')

if (figure && scroller && canvas && svg && tip) {
  const hits = [...svg.querySelectorAll('.ht-hit')]
  const ring = svg.querySelector('.ht-ring')
  let active = -1

  const scrollable = () => scroller.scrollWidth > scroller.clientWidth + 1
  const fit = () => figure.classList.toggle('is-scrollable', scrollable())
  fit()
  window.addEventListener('resize', fit)

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

  const show = (i, reveal = false) => {
    const hit = hits[i]
    if (!hit) return
    active = i
    const cx = Number(hit.getAttribute('cx'))
    const cy = Number(hit.getAttribute('cy'))
    ring?.setAttribute('cx', String(cx))
    ring?.setAttribute('cy', String(cy))
    ring?.classList.add('is-on')
    ring?.classList.toggle('is-branch', hit.hasAttribute('data-branch'))

    tip.replaceChildren(
      line('ht-tip-date', hit.dataset.date ?? ''),
      line('ht-tip-text', hit.dataset.text ?? ''),
      line('ht-tip-who', hit.dataset.who ?? '')
    )
    tip.classList.toggle('is-branch', hit.hasAttribute('data-branch'))

    const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width
    const x = cx * scale
    const half = Math.min(tip.offsetWidth, canvas.clientWidth) / 2
    const left = Math.min(Math.max(x, half + 4), canvas.clientWidth - half - 4)
    tip.style.left = `${left}px`
    tip.style.top = `${cy * scale}px`
    tip.classList.add('is-on')

    if (reveal && scrollable()) {
      const edge = 48
      if (x < scroller.scrollLeft + edge || x > scroller.scrollLeft + scroller.clientWidth - edge) {
        scroller.scrollTo({ left: x - scroller.clientWidth / 2 })
      }
    }
  }

  const hide = () => {
    active = -1
    ring?.classList.remove('is-on')
    tip.classList.remove('is-on')
  }

  hits.forEach((hit, i) => {
    hit.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') show(i)
    })
    hit.addEventListener('click', () => (active === i ? hide() : show(i)))
  })
  svg.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && document.activeElement !== scroller) hide()
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
      show(next, true)
    } else if (event.key === 'Escape') {
      hide()
    }
  })
  scroller.addEventListener('blur', hide)
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
  button.addEventListener('click', async () => {
    const label = button.textContent
    try {
      await navigator.clipboard.writeText(button.dataset.copy)
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select the text to copy'
    }
    setTimeout(() => (button.textContent = label), 1800)
  })
}
