import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const screenSource = readFileSync(
  new URL('../src/renderer/ui/SimulationScreen.tsx', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../src/renderer/styles/v2.css', import.meta.url),
  'utf8',
);

describe('scalable observation panel layout', () => {
  it('separates selected-target details from the tank overview', () => {
    expect(screenSource).toContain("type ObservationView = 'selection' | 'overview'");
    expect(screenSource).toContain('aria-label="관찰 범위"');
    expect(screenSource).toContain("observationView === 'selection'");
    expect(screenSource).toContain("observationView === 'overview'");
    expect(screenSource).toContain('disabled={!hasObservationSelection}');
  });

  it('lets overview categories expand independently and detach into comparison panels', () => {
    expect(screenSource).toContain("type ObservationSection = 'ecology' | 'water' | 'ledger' | 'history'");
    expect(screenSource).toContain('const [openObservationSections, setOpenObservationSections]');
    expect(screenSource).toContain('const [detachedObservationSections, setDetachedObservationSections]');
    expect(screenSource).toContain('toggleObservationSection(section.id)');
    expect(screenSource).toContain('detachObservationSection(section.id)');
    expect(screenSource).toContain('className="detached-observation-stack"');
    expect(screenSource).toContain('<ObservationDockGlyph direction="detach" />');
    expect(screenSource).toContain('<ObservationDockGlyph direction="attach" />');
  });

  it('keeps the color map independent from the observation record panel', () => {
    expect(screenSource).toContain('const [waterQualityMapVisible, setWaterQualityMapVisible]');
    expect(screenSource).toContain('const [waterQualityLegendCollapsed, setWaterQualityLegendCollapsed]');
    expect(screenSource).toContain('waterQualityLayers={waterQualityMapVisible ? waterQualityLayers : []}');
    expect(screenSource).toContain('collapsed={waterQualityLegendCollapsed}');
    expect(screenSource).toContain("aria-label={collapsed ? '색 지도 범례 펼치기' : '색 지도 범례 접기'}");
    expect(screenSource).toContain("waterQualityMapVisible ? '색 지도 끄기' : '색 지도 켜기'");
    expect(screenSource).toContain('aria-label="색 지도 닫기"');
    expect(styles).toContain('.tank-first-screen .tank-analysis-toolbar.is-collapsed');
    expect(screenSource).toContain("useState<WaterQualityLayer[]>(['organicMatter'])");
    expect(screenSource).not.toContain("setWaterQualityLayers((current) => current.length ? current : ['organicMatter'])");
  });

  it('restores the previous color-map view after microbial placement', () => {
    expect(screenSource).toContain('const biofilmOverlayRestoreRef = useRef<WaterQualityViewState | null>(null)');
    expect(screenSource).toContain('setWaterQualityLayers(biofilmPlacementLayers(guildId))');
    expect(screenSource).toContain('restoreBiofilmOverlay();');
  });

  it('gives every detached panel stable independent geometry', () => {
    expect(screenSource).toContain('interface DetachedPanelLayout');
    expect(screenSource).toContain('const [detachedPanelLayouts, setDetachedPanelLayouts]');
    expect(screenSource).toContain('createDetachedPanelLayout(section');
    expect(screenSource).toContain('beginDetachedPanelDrag(event, section.id)');
    expect(screenSource).toContain('left: `${layout.x}px`');
    expect(screenSource).toContain('height: `${layout.height}px`');
    expect(styles).toMatch(/\.detached-observation-stack \{[\s\S]*?pointer-events: none;/);
    expect(styles).toMatch(/\.detached-observation-panel \{[\s\S]*?position: absolute;/);
    expect(styles).toMatch(/\.detached-observation-heading \{[\s\S]*?cursor: grab;/);
    expect(styles).toMatch(/\.detached-observation-heading \{[\s\S]*?touch-action: none;/);
  });

  it('resizes detached panels and keeps only their body scrollable', () => {
    expect(screenSource).toContain('const DETACHED_PANEL_BOTTOM = DETACHED_PANEL_EDGE');
    expect(screenSource).toContain('beginDetachedPanelResize(event, section.id)');
    expect(screenSource).toContain("setDetachedPanelInteraction('resize')");
    expect(screenSource).toContain('className="detached-observation-resize-handle"');
    expect(styles).toMatch(/\.detached-observation-body \{[\s\S]*?flex: 1 1 auto;/);
    expect(styles).toMatch(/\.detached-observation-body \{[\s\S]*?overflow-y: auto;/);
    expect(styles).toMatch(/\.detached-observation-resize-handle \{[\s\S]*?cursor: nwse-resize;/);
    expect(styles).toMatch(/\.detached-observation-body \.animal-event-list \{[\s\S]*?overflow: visible;/);
  });

  it('scrolls only the content below the heading and scope tabs', () => {
    expect(screenSource).toContain('className="floating-observation-scroll"');
    expect(styles).toContain('.floating-observation-scroll {');
    expect(styles).toMatch(/\.floating-observation-scroll \{[\s\S]*?overflow-y: auto;/);
    expect(styles).toMatch(/\.floating-observation-heading \{[\s\S]*?position: relative;/);
    expect(styles).not.toMatch(/\.floating-observation-heading \{[\s\S]*?position: sticky;/);
  });

  it('uses the full right edge and lets the observation dock height be adjusted', () => {
    expect(screenSource).toContain('const [rightPanelHeight, setRightPanelHeight]');
    expect(screenSource).toContain('className="floating-info-resize-handle"');
    expect(screenSource).toContain('onPointerDown={beginRightPanelResize}');
    expect(screenSource).toContain('onDoubleClick={() => setRightPanelHeight(null)}');
    expect(styles).toMatch(/\.floating-info-stack\.has-observation-dock \{[\s\S]*?height: calc\(100% - var\(--floating-panel-top\) - var\(--workspace-edge\)\);/);
    expect(styles).toMatch(/\.floating-info-resize-handle \{[\s\S]*?cursor: ns-resize;/);
  });

  it('keeps camera controls on a stable screen edge instead of shifting them toward the center', () => {
    expect(styles).toMatch(/\.aquarium-camera-controls \{[\s\S]*?left: var\(--workspace-edge\);[\s\S]*?flex-direction: column;/);
    expect(styles).not.toContain('.tank-first-screen.has-right-panel .aquarium-camera-controls,');
  });
});
