/**
 * The API guide says what the server does. The server's own source is read
 * here, so a route, an error code or a permission added there without a word
 * here fails this file rather than surprising a developer.
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { ApiGuidePage } from './ApiGuidePage';
import { BASE_URL, ENDPOINTS, ERRORS, PERMISSIONS } from './apiGuideContent';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const apiSource = ['routes.js', 'http.js', 'apiAuth.js'].map((file) => read(`functions/companyApi/${file}`)).join('\n');

describe('the API guide', () => {
    it('names every route the server answers', () => {
        const served = [...read('functions/companyApi/routes.js').matchAll(/name: '(GET \/v1\/[^']+)'/g)].map((match) => match[1]);
        expect(served.length).toBeGreaterThan(0);
        expect(ENDPOINTS.map((endpoint) => endpoint.route).sort()).toEqual([...served].sort());
    });

    it('names every error code the server sends, with its status', () => {
        const thrown = [...apiSource.matchAll(/new ApiError\(\s*(\d{3}),\s*'([a-z_]+)'/g)].map((match) => `${match[1]} ${match[2]}`);
        const sent = [...apiSource.matchAll(/send\(res, (\d{3}), \{ error: \{ code: '([a-z_]+)'/g)].map((match) => `${match[1]} ${match[2]}`);
        const documented = new Set(ERRORS.map((error) => `${error.status} ${error.code}`));
        for (const pair of new Set([...thrown, ...sent, '429 rate_limited'])) expect(documented).toContain(pair);
    });

    it('names every permission a key can hold', () => {
        const scopes = [...read('functions/companyApi/apiKeys.js').matchAll(/^\s+'([a-z]+:[a-z]+)': '/gm)].map((match) => match[1]);
        expect(PERMISSIONS.map((permission) => permission.scope)).toEqual(scopes);
    });

    it('points at the deployed function of this project', () => {
        const project = JSON.parse(read('.firebaserc')).projects.default;
        expect(BASE_URL).toBe(`https://us-central1-${project}.cloudfunctions.net/companyApi`);
        expect(read('functions/index.js')).toMatch(/exports\.companyApi = /);
    });

    it('renders every endpoint, and has no detectable accessibility violations', async () => {
        const { container } = render(<ApiGuidePage />);
        expect(screen.getByRole('heading', { level: 1, name: 'SafeHaul API' })).toBeInTheDocument();
        for (const endpoint of ENDPOINTS) {
            expect(screen.getByRole('heading', { level: 3, name: `GET ${endpoint.path}` })).toBeInTheDocument();
        }
        expect((await axe(container)).violations).toEqual([]);
    });
});
