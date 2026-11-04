import type { StylesheetStyle } from 'cytoscape'
import {
  NODE_LABEL_FONT_SIZE,
  MIN_ZOOMED_FONT_SIZE,
  RELATIONSHIP_LINE_STYLES,
  isHighContrastTheme,
  type GraphCanvasTheme
} from './causalGraphPresentation'

/**
 * Emitted on the Cytoscape instance after a theme change has replaced the
 * stylesheet, so an overlay that snapshots it (the performance manager) can
 * drop its stale copy and reapply itself on the new one.
 */
export const GRAPH_STYLESHEET_REPLACED_EVENT = 'graphstylesheetreplaced'

/**
 * The causal graph's Cytoscape stylesheet for one theme.
 *
 * Built from the resolved theme rather than written inline, so a switch of
 * theme (dark, high contrast) can replace the whole sheet with one call and
 * every node and edge colour follows -- not only the label text.
 *
 * Order matters: in Cytoscape a later rule wins whatever its selector, so
 * state rules (selected, highlighted, link source) come after the base and
 * type rules they override.
 */
export function buildCausalGraphStylesheet(theme: GraphCanvasTheme): StylesheetStyle[] {
  const c = theme.colors
  const highContrast = isHighContrastTheme(theme)
  // High contrast draws thicker borders and lines (width still tracks weight)
  const nodeBorder = highContrast ? 3 : 2
  const edgeWidth = highContrast ? 'mapData(weight, 0, 1, 3, 9)' : 'mapData(weight, 0, 1, 2, 8)'

  const typeRules: StylesheetStyle[] = (['indirect', 'contributory'] as const).map((type) => {
    const line = RELATIONSHIP_LINE_STYLES[type]
    return {
      selector: `edge[relationshipType = "${type}"]`,
      style: {
        'line-style': line.lineStyle,
        'line-dash-pattern': [...(line.dash ?? [])],
        'line-cap': line.cap,
        'line-color': c[line.paletteKey],
        'target-arrow-color': c[line.paletteKey]
      }
    }
  })

  return [
    // Node styles
    {
      selector: 'node',
      style: {
        'background-color': c.nodeFill,
        'border-color': c.nodeBorder,
        'border-width': nodeBorder,
        // Every node is labelled with what happened (the event's short
        // description; see causalGraphPresentation). The label sits under
        // the node in the theme's ink on a pill of the card surface:
        // centred white text overflowed a 45px node onto the canvas and
        // could not be read.
        'label': 'data(label)',
        'color': theme.ink,
        'font-family': theme.fontFamily,
        'font-size': `${NODE_LABEL_FONT_SIZE}px`,
        'font-weight': 600,
        // Zoomed far out a label would shrink to a few unreadable pixels;
        // below this on-screen size it is not drawn at all.
        'min-zoomed-font-size': MIN_ZOOMED_FONT_SIZE,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 6,
        'text-wrap': 'wrap',
        'text-max-width': '120px',
        'text-background-color': theme.surface,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'width': 'mapData(weight, 0, 1, 22, 56)',
        'height': 'mapData(weight, 0, 1, 22, 56)',
        'overlay-padding': '6px',
        'z-index': 10
      }
    },

    // Foreign placeholder node (a cross-graph or missing event): dashed border, rounded square
    {
      selector: 'node.foreign-node',
      style: {
        'background-color': c.foreignFill,
        'border-color': c.foreignBorder,
        'border-style': 'dashed',
        'border-width': 3,
        'shape': 'round-rectangle',
        'z-index': 12
      }
    },

    // Point of divergence (counterfactual branch fork): a diamond, so it is
    // not told apart by colour alone
    {
      selector: 'node.divergence-point',
      style: {
        'background-color': c.divergenceFill,
        'border-color': c.divergenceBorder,
        'border-width': 4,
        'shape': 'diamond',
        // The label keeps the base ink: it sits on the label pill under
        // the node, where white text on the light pill was invisible.
        'font-weight': 'bold',
        'overlay-color': c.divergenceFill,
        'overlay-padding': '5px',
        'overlay-opacity': 0.25,
        'z-index': 24
      }
    },

    // Selected node (the indigo selection accent, distinct from danger red);
    // its thicker border also marks it without relying on colour
    {
      selector: 'node:selected',
      style: {
        'background-color': c.selectedFill,
        'border-color': c.selectedBorder,
        'border-width': 4
      }
    },

    // Hovered node, or a node on a highlighted path
    {
      selector: 'node.highlighted',
      style: {
        'background-color': c.highlightedFill,
        'border-color': c.highlightedBorder,
        'border-width': 4,
        'z-index': 20
      }
    },

    // Tracing a selection's ripple (as on the timeline): what is off it fades
    // back. Inactive context, so it may sit under the 3:1 floor (WCAG 1.4.11).
    {
      selector: 'node.ripple-faded',
      style: {
        'opacity': 0.25,
        'text-opacity': 0.35
      }
    },
    {
      selector: 'edge.ripple-faded',
      style: {
        'opacity': 0.12
      }
    },

    // A label that would overprint a more important one is not drawn...
    {
      selector: 'node.label-culled',
      style: {
        'text-opacity': 0,
        'text-background-opacity': 0
      }
    },
    // ...unless its node is the one being looked at
    {
      selector: 'node.label-culled:selected, node.label-culled.highlighted, node.label-culled.ripple',
      style: {
        'text-opacity': 1,
        'text-background-opacity': 0.9,
        'z-index': 30
      }
    },

    // The cause picked while drawing a link
    {
      selector: 'node.link-source',
      style: {
        'background-color': c.linkSourceFill,
        'border-color': c.linkSourceBorder,
        'border-width': 5,
        'z-index': 25
      }
    },

    // An event that cannot be the effect of the picked cause (it happens
    // before it): inactive, so deliberately dimmed
    {
      selector: 'node.invalid-target',
      style: {
        'background-color': c.inactiveFill,
        'border-color': c.inactiveBorder,
        'border-width': 2,
        'opacity': 0.5,
        'z-index': 5
      }
    },

    // Edges. Width is the link's weight; colour and line style are its type
    // (direct is the base: solid).
    {
      selector: 'edge',
      style: {
        'width': edgeWidth,
        'line-color': c.edgeDirect,
        'target-arrow-color': c.edgeDirect,
        'line-style': 'solid',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.2,
        // Fully opaque: translucency would blend the line toward the canvas
        // and below the 3:1 its colour is chosen to meet.
        'opacity': 1,
        'z-index': 5
      }
    },
    ...typeRules,

    // A link to or from another graph keeps its type's line style, takes the
    // cross-graph colour, and is labelled with the other graph
    {
      selector: 'edge.cross-graph',
      style: {
        'line-color': c.edgeCrossGraph,
        'target-arrow-color': c.edgeCrossGraph,
        'label': 'data(crossGraphLabel)',
        'font-family': theme.fontFamily,
        'font-size': '11px',
        'min-zoomed-font-size': MIN_ZOOMED_FONT_SIZE,
        'color': theme.ink,
        'text-background-color': theme.surface,
        'text-background-opacity': 0.95,
        'text-background-padding': '3px',
        'text-border-color': c.edgeCrossGraph,
        'text-border-width': 1,
        'text-border-opacity': 1,
        'z-index': 10
      }
    },

    // Selected edge
    {
      selector: 'edge:selected',
      style: {
        'line-color': c.edgeSelected,
        'target-arrow-color': c.edgeSelected,
        'width': 6,
        'z-index': 15
      }
    },

    // Hovered edge
    {
      selector: 'edge.highlighted',
      style: {
        'line-color': c.edgeHighlighted,
        'target-arrow-color': c.edgeHighlighted,
        'width': 6,
        'z-index': 15
      }
    },

    // Edge labels
    {
      selector: 'edge.show-label',
      style: {
        'label': 'data(label)',
        'font-family': theme.fontFamily,
        'font-size': '11px',
        'min-zoomed-font-size': MIN_ZOOMED_FONT_SIZE,
        'color': theme.inkSecondary,
        'text-background-color': theme.surface,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'text-border-color': theme.line,
        'text-border-width': 1,
        'text-border-opacity': 0.5
      }
    }
  ]
}
