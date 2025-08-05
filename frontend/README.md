# Frontend Timeline Interface

A React-based web application for visualizing and manipulating hierarchical temporal graphs. This frontend provides interactive timeline and causal graph visualizations for historical data analysis.

## Features

- Interactive timeline visualization with D3.js
- Causal graph visualization with Cytoscape.js
- Actor perspective views
- Real-time data filtering and search
- Responsive design for mobile and desktop
- TypeScript for type safety
- Comprehensive testing suite

## Tech Stack

- **Frontend**: React 19.1 with TypeScript
- **Build Tool**: Vite 7.0.6
- **State Management**: Zustand 5.0.7
- **Data Fetching**: React Query 5.84.1
- **Routing**: React Router v7
- **Styling**: Tailwind CSS 4
- **Visualization**: D3.js 7.9.0, Cytoscape.js 3.33.0
- **Testing**: Vitest, React Testing Library, Playwright

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env.local
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:5173](http://localhost:5173) in your browser.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run test` - Run tests
- `npm run test:watch` - Run tests in watch mode
- `npm run lint` - Run ESLint

## Project Structure

```
src/
├── components/          # React components
│   ├── layout/         # Layout components
│   ├── routing/        # Routing components
│   └── views/          # Main view components
├── hooks/              # Custom React hooks
├── services/           # API services
├── stores/             # Zustand stores
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
└── test/               # Test setup and utilities
```

## Development

This project follows the component-driven development approach with:

- Strict TypeScript configuration
- Path aliases for clean imports
- Comprehensive error handling
- Performance optimizations
- Accessibility compliance

## Testing

Run the test suite:

```bash
npm run test
```

For watch mode during development:

```bash
npm run test:watch
```

## Contributing

1. Follow the existing code style and conventions
2. Write tests for new features
3. Update documentation as needed
4. Ensure all tests pass before submitting

## License

This project is part of the Timeline Interface system.