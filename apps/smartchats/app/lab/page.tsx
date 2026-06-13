'use client';

import Link from 'next/link';

const EXPERIMENTS = [
    {
        slug: 'handmap',
        name: 'Handmap',
        tagline: 'Record where your right hand actually touches the screen',
        description:
            'A guided six-step capture flow: palm rest, then each finger one at a time. Each finger step is open-ended — touch every natural position you can reach, then advance. The result is a structured per-finger map of points you can inspect visually and as raw JSON, and use to drive future layouts.',
    },
    {
        slug: 'grid',
        name: 'Grid',
        tagline: 'Square QWERTY keyboard with 5 swappable layouts',
        description:
            'A simple, fills-the-screen QWERTY keyboard with percentage-based positioning, so it adapts to portrait or landscape in any container. Five live layout variants — Classic, Thumb-Left, Left Rail, with Numbers, Compact — you can switch between in the app to find what fits your hand. Same telemetry pipeline as Onehand; rows tagged with the active variant.',
    },
    {
        slug: 'onehand',
        name: 'Onehand',
        tagline: 'Ergonomic one-handed iPad keyboard',
        description:
            'A right-hand-only touch keyboard built around a palm-anchored two-arc layout. Audio click feedback, full keystroke telemetry, live WPM, history view. Designed for iPad landscape with the palm resting in the lower-right of the screen.',
    },
];

export default function LabIndexPage() {
    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(180deg, #0b0b14 0%, #15151f 100%)',
                color: '#e8e8f0',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                padding: '32px 24px 64px',
            }}
        >
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
                <div style={{ marginBottom: 32 }}>
                    <div
                        style={{
                            fontSize: 11,
                            letterSpacing: '0.18em',
                            color: '#7c7c9e',
                            textTransform: 'uppercase',
                            marginBottom: 8,
                        }}
                    >
                        SmartChats / Laboratory
                    </div>
                    <h1 style={{ fontSize: 38, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>
                        Experiments
                    </h1>
                    <p style={{ color: '#9090b0', marginTop: 10, maxWidth: 560, lineHeight: 1.55 }}>
                        A scratchpad for new interfaces and ideas worth shipping. Each entry is a self-contained
                        prototype that can stand or fall on its own merits.
                    </p>
                </div>

                <div style={{ display: 'grid', gap: 16 }}>
                    {EXPERIMENTS.map((exp) => (
                        <Link
                            key={exp.slug}
                            href={`/lab/${exp.slug}`}
                            style={{
                                display: 'block',
                                textDecoration: 'none',
                                color: 'inherit',
                                background: 'rgba(255, 255, 255, 0.025)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: 14,
                                padding: '22px 24px',
                                transition: 'border-color 200ms ease, background 200ms ease',
                            }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    gap: 14,
                                    marginBottom: 6,
                                }}
                            >
                                <span style={{ fontSize: 20, fontWeight: 600 }}>{exp.name}</span>
                                <span
                                    style={{
                                        fontSize: 12,
                                        color: '#7c7c9e',
                                        fontVariantCaps: 'all-small-caps',
                                        letterSpacing: '0.08em',
                                    }}
                                >
                                    /lab/{exp.slug}
                                </span>
                            </div>
                            <div style={{ color: '#c8c8e0', fontSize: 14, marginBottom: 8 }}>{exp.tagline}</div>
                            <div style={{ color: '#9090b0', fontSize: 13, lineHeight: 1.55 }}>{exp.description}</div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
