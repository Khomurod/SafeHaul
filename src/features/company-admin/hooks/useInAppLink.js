import { useNavigate } from 'react-router-dom';

/**
 * A link inside the app, for a `Link` or `ButtonLink` whose destination carries
 * state (`{ href, state }`): a plain press stays in the page and passes the
 * state; any other press (a new tab, a modified click) opens as the browser would.
 */
export function useInAppLink() {
    const navigate = useNavigate();
    return (link) => (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(link.href, link.state ? { state: link.state } : undefined);
    };
}
