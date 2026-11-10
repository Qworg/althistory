// On a narrow screen the hero timeline scrolls sideways; start it at the fork.
const scroller = document.querySelector('.hero-scroll')
const timeline = scroller?.querySelector('svg[data-fork-x]')
if (scroller && timeline && scroller.scrollWidth > scroller.clientWidth) {
  const fork = Number(timeline.dataset.forkX) * scroller.scrollWidth
  scroller.scrollLeft = Math.max(0, fork - scroller.clientWidth * 0.25)
}

// Copy the quick-start commands.
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
