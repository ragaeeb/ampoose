import '@wxt-dev/module-react';
import { defineConfig } from 'wxt';
import { description, version } from './package.json';
import { DOMAIN_MATCHES } from './src/shared/constants';

export default defineConfig({
    hooks: {
        'build:manifestGenerated': (_wxt, manifest) => {
            if (!Array.isArray(manifest.content_scripts)) {
                return;
            }

            const seen = new Set<string>();
            manifest.content_scripts = manifest.content_scripts.filter((entry) => {
                const signature = JSON.stringify({
                    allFrames: entry.all_frames ?? false,
                    css: [...(entry.css ?? [])].sort(),
                    excludeMatches: [...(entry.exclude_matches ?? [])].sort(),
                    js: [...(entry.js ?? [])].sort(),
                    matchAboutBlank: entry.match_about_blank ?? false,
                    matches: [...(entry.matches ?? [])].sort(),
                    runAt: entry.run_at ?? 'document_idle',
                    world: (entry as Record<string, unknown>).world ?? 'ISOLATED',
                });

                if (seen.has(signature)) {
                    return false;
                }
                seen.add(signature);
                return true;
            });

            // Ensure MAIN world bridge is available before the isolated UI script tries to use it.
            manifest.content_scripts.sort((a, b) => {
                const aWorld = (a as Record<string, unknown>).world;
                const bWorld = (b as Record<string, unknown>).world;
                const aRank = aWorld === 'MAIN' ? 0 : 1;
                const bRank = bWorld === 'MAIN' ? 0 : 1;
                if (aRank !== bRank) {
                    return aRank - bRank;
                }

                const aJs = (a.js?.[0] ?? '').toString();
                const bJs = (b.js?.[0] ?? '').toString();
                return aJs.localeCompare(bJs);
            });
        },
    },
    manifest: {
        description,
        icons: {
            '16': 'src/assets/logo/favicon-16.png',
            '19': 'src/assets/logo/favicon-19.png',
            '32': 'src/assets/logo/favicon-32.png',
            '38': 'src/assets/logo/favicon-38.png',
            '48': 'src/assets/logo/favicon-48.png',
            '128': 'src/assets/logo/favicon-128.png',
        },
        incognito: 'not_allowed',
        minimum_chrome_version: '103',
        name: 'Ampoose',
        permissions: ['storage', 'downloads'],
        version,
        web_accessible_resources: [
            {
                matches: DOMAIN_MATCHES,
                resources: ['src/assets/logo/icon.svg'],
            },
        ],
    },
    modules: ['@wxt-dev/module-react'],
    outDir: 'dist',
    srcDir: 'src',
});
