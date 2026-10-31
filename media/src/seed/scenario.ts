/**
 * The demo graph every screenshot and the walkthrough video are taken from.
 *
 * It is curated rather than generated so that the pictures are stable from run
 * to run: the media should change when the product changes, not because a
 * model wrote a different history this time.
 *
 * The premise: Charles Babbage's Analytical Engine is finished in 1843 instead
 * of being abandoned, and Victorian Britain gets programmable computing a
 * century early.
 */

export interface ArcSeed {
  key: string
  name: string
  description: string
  start: string
  end: string
  level: number
  parent?: string
}

export interface EventSeed {
  key: string
  description: string
  actor: string
  target: string
  timestamp: string
  arc: string
  significance?: number
}

export interface LinkSeed {
  cause: string
  effect: string
  type: 'direct' | 'indirect' | 'contributory'
  weight: number
  confidence: number
  evidence: string
}

export interface BranchSeed {
  name: string
  description: string
  /** Events the branch adds on top of the copied history; links join only these. */
  events: EventSeed[]
  links: LinkSeed[]
}

export interface Scenario {
  graph: { name: string; description: string }
  arcs: ArcSeed[]
  events: EventSeed[]
  links: LinkSeed[]
  branch: BranchSeed
}

export const scenario: Scenario = {
  graph: {
    name: 'The Engine Age',
    description:
      'What if Babbage finished the Analytical Engine in 1843? A Victorian computing revolution, a century early.',
  },

  arcs: [
    {
      key: 'build',
      name: 'Building the Engine',
      description: 'Babbage, Lovelace and Clement turn the design into working brass.',
      start: '1834-01-01T00:00:00Z',
      end: '1844-06-30T00:00:00Z',
      level: 1,
    },
    {
      key: 'offices',
      name: 'The Calculating Offices',
      description: 'Engines spread through the Admiralty, insurers and the census.',
      start: '1844-07-01T00:00:00Z',
      end: '1858-12-31T00:00:00Z',
      level: 1,
    },
    {
      key: 'telegraph',
      name: 'Engines on the Wire',
      description: 'Telegraphy links the engines into a network of tabulating houses.',
      start: '1851-01-01T00:00:00Z',
      end: '1858-12-31T00:00:00Z',
      level: 2,
      parent: 'offices',
    },
    {
      key: 'reaction',
      name: 'The Clerks’ Rebellion',
      description: 'Displaced clerks, rival powers and Parliament push back.',
      start: '1859-01-01T00:00:00Z',
      end: '1871-12-31T00:00:00Z',
      level: 1,
    },
  ],

  events: [
    {
      key: 'design',
      description: 'Babbage completes the full design of the Analytical Engine',
      actor: 'Charles Babbage',
      target: 'Analytical Engine',
      timestamp: '1834-12-15T00:00:00Z',
      arc: 'build',
      significance: 0.7,
    },
    {
      key: 'peel',
      description: 'Prime Minister Peel reverses course and funds construction',
      actor: 'Robert Peel',
      target: 'Charles Babbage',
      timestamp: '1838-03-02T00:00:00Z',
      arc: 'build',
      significance: 0.9,
    },
    {
      key: 'clement',
      description: 'Joseph Clement standardises the engine’s gears and screw threads',
      actor: 'Joseph Clement',
      target: 'Analytical Engine',
      timestamp: '1839-09-10T00:00:00Z',
      arc: 'build',
      significance: 0.6,
    },
    {
      key: 'noteg',
      description: 'Ada Lovelace publishes Note G, the first program',
      actor: 'Ada Lovelace',
      target: 'Analytical Engine',
      timestamp: '1843-09-01T00:00:00Z',
      arc: 'build',
      significance: 0.95,
    },
    {
      key: 'firstrun',
      description: 'The Engine computes Bernoulli numbers before the Royal Society',
      actor: 'Charles Babbage',
      target: 'Royal Society',
      timestamp: '1843-11-20T00:00:00Z',
      arc: 'build',
      significance: 1,
    },
    {
      key: 'admiralty',
      description: 'The Admiralty orders engines to compute navigation tables',
      actor: 'British Admiralty',
      target: 'Analytical Engine',
      timestamp: '1845-04-14T00:00:00Z',
      arc: 'offices',
      significance: 0.8,
    },
    {
      key: 'lloyds',
      description: 'Lloyd’s opens an actuarial engine room for the insurance market',
      actor: 'Lloyd’s of London',
      target: 'Analytical Engine',
      timestamp: '1847-06-01T00:00:00Z',
      arc: 'offices',
      significance: 0.6,
    },
    {
      key: 'bank',
      description: 'The Bank of England moves its ledgers onto engines',
      actor: 'Bank of England',
      target: 'Analytical Engine',
      timestamp: '1847-06-18T00:00:00Z',
      arc: 'offices',
      significance: 0.65,
    },
    {
      key: 'school',
      description: 'Lovelace founds the School of Engine Programming in London',
      actor: 'Ada Lovelace',
      target: 'School of Engine Programming',
      timestamp: '1848-10-05T00:00:00Z',
      arc: 'offices',
      significance: 0.75,
    },
    {
      key: 'census',
      description: 'The 1851 census is tabulated entirely by engine',
      actor: 'General Register Office',
      target: 'Census of 1851',
      timestamp: '1851-05-30T00:00:00Z',
      arc: 'telegraph',
      significance: 0.85,
    },
    {
      key: 'exhibition',
      description: 'The Great Exhibition’s centrepiece is a working engine hall',
      actor: 'Prince Albert',
      target: 'Great Exhibition',
      timestamp: '1851-07-01T00:00:00Z',
      arc: 'telegraph',
      significance: 0.7,
    },
    {
      key: 'wire',
      description: 'Engines in London and Manchester exchange results by telegraph',
      actor: 'Electric Telegraph Company',
      target: 'Analytical Engine',
      timestamp: '1853-02-11T00:00:00Z',
      arc: 'telegraph',
      significance: 0.85,
    },
    {
      key: 'prussia',
      description: 'Prussia buys three engines for its General Staff',
      actor: 'Prussian General Staff',
      target: 'Analytical Engine',
      timestamp: '1855-08-20T00:00:00Z',
      arc: 'telegraph',
      significance: 0.7,
    },
    {
      key: 'clerks',
      description: 'Ten thousand clerks protest at Westminster against the engines',
      actor: 'Clerks’ Union',
      target: 'Parliament',
      timestamp: '1859-03-17T00:00:00Z',
      arc: 'reaction',
      significance: 0.8,
    },
    {
      key: 'manchester',
      description: 'Manchester clerks hold a demonstration in solidarity',
      actor: 'Clerks’ Union',
      target: 'Manchester Exchange',
      timestamp: '1859-03-29T00:00:00Z',
      arc: 'reaction',
      significance: 0.5,
    },
    {
      key: 'debate',
      description: 'Parliament debates engine licensing legislation',
      actor: 'Parliament',
      target: 'Analytical Engine',
      timestamp: '1860-06-05T00:00:00Z',
      arc: 'reaction',
      significance: 0.6,
    },
    {
      key: 'act',
      description: 'Parliament passes the Engine Licensing Act',
      actor: 'Parliament',
      target: 'Clerks’ Union',
      timestamp: '1860-06-28T00:00:00Z',
      arc: 'reaction',
      significance: 0.75,
    },
    {
      key: 'moltke',
      description: 'Moltke uses engine-planned railway timetables to mobilise',
      actor: 'Prussian General Staff',
      target: 'Austrian Empire',
      timestamp: '1866-06-16T00:00:00Z',
      arc: 'reaction',
      significance: 0.85,
    },
    {
      key: 'race',
      description: 'Britain and Prussia begin an engine arms race',
      actor: 'British Admiralty',
      target: 'Prussian General Staff',
      timestamp: '1868-01-09T00:00:00Z',
      arc: 'reaction',
      significance: 0.8,
    },
  ],

  links: [
    { cause: 'design', effect: 'peel', type: 'contributory', weight: 0.6, confidence: 0.7, evidence: 'The finished design made the cost estimate credible.' },
    { cause: 'peel', effect: 'clement', type: 'direct', weight: 0.8, confidence: 0.85, evidence: 'Funding paid for Clement’s workshop.' },
    { cause: 'clement', effect: 'firstrun', type: 'direct', weight: 0.85, confidence: 0.8, evidence: 'Standard parts made assembly possible.' },
    { cause: 'design', effect: 'noteg', type: 'contributory', weight: 0.5, confidence: 0.75, evidence: 'Note G was written against the published design.' },
    { cause: 'noteg', effect: 'firstrun', type: 'direct', weight: 0.9, confidence: 0.9, evidence: 'The demonstration ran Lovelace’s program.' },
    { cause: 'firstrun', effect: 'admiralty', type: 'direct', weight: 0.8, confidence: 0.85, evidence: 'Naval officers attended the demonstration.' },
    { cause: 'firstrun', effect: 'lloyds', type: 'contributory', weight: 0.6, confidence: 0.7, evidence: 'Actuaries saw the tables could be trusted.' },
    { cause: 'noteg', effect: 'school', type: 'direct', weight: 0.7, confidence: 0.8, evidence: 'Demand for programmers outstripped Lovelace’s pupils.' },
    { cause: 'school', effect: 'census', type: 'contributory', weight: 0.6, confidence: 0.7, evidence: 'The Register Office hired the first graduates.' },
    { cause: 'admiralty', effect: 'census', type: 'indirect', weight: 0.4, confidence: 0.6, evidence: 'Admiralty engines proved reliability at scale.' },
    { cause: 'census', effect: 'exhibition', type: 'contributory', weight: 0.5, confidence: 0.65, evidence: 'The census made the engine a national symbol.' },
    { cause: 'lloyds', effect: 'wire', type: 'contributory', weight: 0.55, confidence: 0.6, evidence: 'Insurers wanted prices shared between cities.' },
    { cause: 'exhibition', effect: 'prussia', type: 'direct', weight: 0.7, confidence: 0.75, evidence: 'Prussian officers toured the engine hall.' },
    { cause: 'census', effect: 'clerks', type: 'direct', weight: 0.8, confidence: 0.8, evidence: 'Census clerks were the first laid off.' },
    { cause: 'lloyds', effect: 'clerks', type: 'contributory', weight: 0.5, confidence: 0.65, evidence: 'Insurance clerks followed.' },
    { cause: 'lloyds', effect: 'bank', type: 'contributory', weight: 0.5, confidence: 0.6, evidence: 'The Bank followed the insurers’ lead.' },
    { cause: 'clerks', effect: 'manchester', type: 'direct', weight: 0.7, confidence: 0.75, evidence: 'Word of the march reached Manchester by telegraph.' },
    { cause: 'clerks', effect: 'debate', type: 'direct', weight: 0.75, confidence: 0.8, evidence: 'The march forced the question onto the Commons’ order paper.' },
    { cause: 'debate', effect: 'act', type: 'direct', weight: 0.85, confidence: 0.85, evidence: 'The debate produced the Act.' },
    { cause: 'clerks', effect: 'act', type: 'direct', weight: 0.85, confidence: 0.85, evidence: 'The Act was Parliament’s answer to the march.' },
    { cause: 'wire', effect: 'moltke', type: 'contributory', weight: 0.6, confidence: 0.7, evidence: 'Networked engines made timetables tractable.' },
    { cause: 'prussia', effect: 'moltke', type: 'direct', weight: 0.85, confidence: 0.85, evidence: 'The General Staff’s engines planned the mobilisation.' },
    { cause: 'moltke', effect: 'race', type: 'direct', weight: 0.8, confidence: 0.8, evidence: 'Sadowa alarmed the Admiralty.' },
    { cause: 'act', effect: 'race', type: 'indirect', weight: 0.4, confidence: 0.55, evidence: 'Licensing slowed British engines just as Prussia sped up.' },
  ],

  branch: {
    name: 'The Engine Age — Clerks Prevail',
    description: 'Branch: Parliament bans engines outright in 1860 instead of licensing them.',
    events: [
      {
        key: 'ban',
        description: 'Parliament bans private calculating engines',
        actor: 'Parliament',
        target: 'Analytical Engine',
        timestamp: '1860-07-12T00:00:00Z',
        arc: 'reaction',
        significance: 0.9,
      },
      {
        key: 'exodus',
        description: 'Lovelace’s programmers emigrate to Berlin',
        actor: 'School of Engine Programming',
        target: 'Prussian General Staff',
        timestamp: '1861-04-02T00:00:00Z',
        arc: 'reaction',
        significance: 0.8,
      },
    ],
    links: [
      { cause: 'ban', effect: 'exodus', type: 'direct', weight: 0.85, confidence: 0.8, evidence: 'Berlin offered the work London had outlawed.' },
    ],
  },
}
