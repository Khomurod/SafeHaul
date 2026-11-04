/**
 * A link to show a company signature image in the editor, as the Documents
 * workspace opens a document: `getSignedDocumentUrl` checks the caller's company
 * and signs a read link that lives an hour. A link is minted when someone looks
 * and never stored; the field keeps only the path.
 *
 * The canvas, the properties panel and the signer preview show the same image,
 * so one link per path is reused for 45 minutes rather than signed three times.
 * A failed signing is forgotten, so the next look tries again; meanwhile the
 * image is simply absent, which every caller draws as "no image".
 */
import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

const REUSE_MS = 45 * 60 * 1000;

/** path -> { link: Promise<string>, at } */
const links = new Map();

function signedLink(path) {
    const held = links.get(path);
    if (held && Date.now() - held.at < REUSE_MS) return held.link;
    const link = Promise.resolve()
        .then(() => httpsCallable(functions, 'getSignedDocumentUrl')({ storagePath: path }))
        .then(({ data }) => {
            if (!data?.url) throw new Error('No link was returned.');
            return data.url;
        });
    links.set(path, { link, at: Date.now() });
    link.catch((error) => {
        console.error('[company signature] Could not sign a link to show the image:', error);
        if (links.get(path)?.link === link) links.delete(path);
    });
    return link;
}

/** For tests: forget every link. */
export function resetCompanySignatureUrls() {
    links.clear();
}

/** The image's link, or '' while there is none (no path, still signing, or failed). */
export function useCompanySignatureUrl(path) {
    const key = String(path || '').trim();
    const [shown, setShown] = useState({ key: '', url: '' });

    useEffect(() => {
        if (!key) return undefined;
        let current = true;
        signedLink(key).then((url) => { if (current) setShown({ key, url }); }, () => {});
        return () => { current = false; };
    }, [key]);

    return shown.key === key ? shown.url : '';
}
