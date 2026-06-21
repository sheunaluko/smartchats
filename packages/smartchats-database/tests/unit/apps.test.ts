import { describe, it, expect } from 'vitest';
import {
    getAppByAppId,
    updateApp,
    searchApps,
    listApps,
    incrementAppInstallCount,
    updateInstall,
    getInstallByAppId,
    insertApp,
    insertInstall,
} from '../../src/queries/index.js';

describe('getAppByAppId', () => {
    it('looks up a single manifest by the external app_id column', () => {
        const spec = getAppByAppId('com.example.app');
        expect(spec.query).toBe('SELECT * FROM smartchats_apps WHERE app_id = $app_id LIMIT 1');
        expect(spec.variables).toEqual({ app_id: 'com.example.app' });
    });
});

describe('updateApp', () => {
    it('returns null when the patch is empty and no embedding is supplied', () => {
        expect(updateApp({ app_id: 'a', patch: {} })).toBeNull();
    });

    it('emits only the patched field and always bumps updated_at', () => {
        const spec = updateApp({ app_id: 'a', patch: { name: 'Renamed' } })!;
        expect(spec.query).toContain('updated_at = time::now()');
        expect(spec.query).toContain('name = $name');
        expect(spec.query).not.toContain('version =');
        expect(spec.query).toContain('WHERE app_id = $app_id');
    });

    it('treats a sibling embedding as a settable field on its own', () => {
        const spec = updateApp({ app_id: 'a', patch: {}, embedding: [0.1, 0.2] })!;
        expect(spec.query).toContain('embedding = $embedding');
    });
});

describe('searchApps', () => {
    it('surfaces only published apps, ranked by cosine similarity', () => {
        const spec = searchApps({ embedding: [0.1], limit: 5 });
        expect(spec.query).toContain('vector::similarity::cosine(embedding, $emb)');
        expect(spec.query).toContain('WHERE published_at != NONE');
        expect(spec.query).toContain('ORDER BY score DESC');
        expect(spec.variables).toEqual({ emb: [0.1], limit: 5 });
    });
});

describe('listApps', () => {
    it('lists everything ordered by updated_at DESC with no filter', () => {
        const spec = listApps();
        expect(spec.query).not.toContain('WHERE');
        expect(spec.query).toContain('ORDER BY updated_at DESC');
    });

    it('matches a category via membership rather than equality', () => {
        const spec = listApps({ category: 'productivity' });
        expect(spec.query).toContain('$category IN categories');
        expect(spec.variables.category).toBe('productivity');
    });

    it('filters by source when given', () => {
        expect(listApps({ source: 'official' }).query).toContain('source = $source');
    });
});

describe('incrementAppInstallCount', () => {
    it('does an in-place increment rather than a read-modify-write', () => {
        expect(incrementAppInstallCount('a').query).toContain('install_count += 1');
    });
});

describe('install records', () => {
    it('updateInstall returns null on an empty patch', () => {
        expect(updateInstall({ app_id: 'a', patch: {} })).toBeNull();
    });

    it('updateInstall sets a whitelisted field and bumps updated_at', () => {
        const spec = updateInstall({ app_id: 'a', patch: { activation_count: 3 } })!;
        expect(spec.query).toContain('activation_count = $activation_count');
        expect(spec.query).toContain('updated_at = time::now()');
    });

    it('getInstallByAppId fetches the single install row for an app', () => {
        expect(getInstallByAppId('a').query).toBe(
            'SELECT * FROM smartchats_app_installs WHERE app_id = $app_id LIMIT 1',
        );
    });
});

describe('insertApp', () => {
    const args = {
        app_id: 'com.example.app',
        name: 'Example',
        version: '1.0.0',
        description: 'an example app',
        author: null,
        icon: null,
        source: 'official',
        categories: [],
        tags: [],
        embedding: [0.1],
        modules: null,
        interaction_mode: 'voice',
        html_templates: null,
        display_mode: 'inline',
        state_schema: null,
        permissions: null,
        requested_functions: [],
        voice_hooks: null,
        on_activate: null,
        on_deactivate: null,
        external_scripts: null,
        migrations: null,
        min_tier: 'free',
        version_history: [],
        forked_from: null,
        _content_hash: null,
        published_at: null,
    };

    it('initializes the install/rating/flag counters to their defaults', () => {
        const spec = insertApp(args);
        expect(spec.query).toContain('install_count: 0');
        expect(spec.query).toContain('featured: false');
        expect(spec.query).toContain('verified: false');
    });

    it('server-stamps created_at and updated_at on insert', () => {
        const spec = insertApp(args);
        expect(spec.query).toContain('created_at: time::now()');
        expect(spec.query).toContain('updated_at: time::now()');
    });
});

describe('insertInstall', () => {
    it('server-stamps installed_at and updated_at on insert', () => {
        const spec = insertInstall({
            app_id: 'com.example.app',
            installed_version: '1.0.0',
            granted_permissions: null,
            app_state: null,
            config: null,
            last_activated_at: null,
            activation_count: 0,
        });
        expect(spec.query).toContain('installed_at: time::now()');
        expect(spec.query).toContain('updated_at: time::now()');
    });
});
