import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MainLayout } from './MainLayout'

describe('MainLayout', () => {
  it('renders the header with title', () => {
    render(
      <MainLayout>
        <div>Test content</div>
      </MainLayout>
    )
    
    expect(screen.getByText('Timeline Interface')).toBeInTheDocument()
  })

  it('renders children content', () => {
    render(
      <MainLayout>
        <div>Test content</div>
      </MainLayout>
    )
    
    expect(screen.getByText('Test content')).toBeInTheDocument()
  })

  it('has proper structure with header and main', () => {
    render(
      <MainLayout>
        <div>Test content</div>
      </MainLayout>
    )
    
    const header = screen.getByRole('banner')
    const main = screen.getByRole('main')
    
    expect(header).toBeInTheDocument()
    expect(main).toBeInTheDocument()
  })
})