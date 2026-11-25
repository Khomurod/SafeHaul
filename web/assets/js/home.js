/*
 * SafeHaul home page (web/index.html): its one script. No libraries.
 *
 * It loads in the <head>, before the page is drawn, and at once marks <html>:
 * - `js`: the script runs, so the contact form is checked and sent from here;
 * - `motion`: the visitor has not asked for reduced motion, so home.css turns
 *   the hero into the scroll story and lets sections play as they enter.
 * Without the script, or with reduced motion, every section shows its finished
 * state and nothing moves, and the form posts as a plain form.
 *
 * The page never takes over scrolling: the story follows the scroll position,
 * at the visitor's speed. Loops run only while they are on screen.
 */
(function () {
    const root = document.documentElement;
    const motion = 'IntersectionObserver' in window
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.add('js');
    if (motion) root.classList.add('motion');

    /** Matches home.css's phone-width rules. */
    const narrow = window.matchMedia('(max-width: 900px)');
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    /** Where `p` is between `a` and `b`, from 0 to 1. */
    const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const byId = (id) => document.getElementById(id);
    const all = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
    /** Restarts a CSS animation by taking a class off and putting it back. */
    const replay = (element, name) => {
        element.classList.remove(name);
        element.getBoundingClientRect();
        element.classList.add(name);
    };

    const FAILED = 'We could not send your request. Please try again, or email info@safehaul.io.';

    /**
     * The contact form: checked here with the same rules as the server
     * (functions/landing/websiteLead.js), then sent as JSON to /api/contact.
     * The server's answer names a field when one is refused.
     */
    function setUpContactForm() {
        const form = byId('contactForm');
        if (!form || !window.fetch) return;
        const sent = byId('contactSent');
        const summary = byId('contactError');
        const button = form.querySelector('[type="submit"]');
        const label = button.textContent;
        const controls = Array.from(form.elements).filter((control) => control.name && control.name !== 'leave_this_empty');
        form.noValidate = true;

        function problem(control) {
            const value = control.value.trim();
            if (control.required && !value) return true;
            if (!value) return false;
            if (control.type === 'email') return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
            if (control.name === 'phone') return !/^[0-9+().\-\s]+$/.test(value) || value.replace(/\D/g, '').length < 7;
            return false;
        }
        /** `message`: false clears, true shows the page's own words, a string shows the server's. */
        function mark(control, message) {
            const note = byId(`err-${control.name}`);
            control.setAttribute('aria-invalid', message ? 'true' : 'false');
            if (!note) return;
            if (!note.dataset.text) note.dataset.text = note.textContent;
            note.textContent = typeof message === 'string' ? message : note.dataset.text;
            note.hidden = !message;
        }
        function tell(message) {
            summary.textContent = message;
            summary.hidden = !message;
        }

        form.addEventListener('input', (event) => {
            const control = event.target;
            if (control.getAttribute('aria-invalid') === 'true' && !problem(control)) mark(control, false);
        });

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (button.disabled) return;
            const refused = controls.filter(problem);
            controls.forEach((control) => mark(control, refused.includes(control)));
            if (refused.length) {
                tell(refused.length === 1 ? 'One field needs your attention.' : `${refused.length} fields need your attention.`);
                refused[0].focus();
                return;
            }
            tell('');
            button.disabled = true;
            button.textContent = 'Sending…';
            try {
                const response = await fetch(form.action, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.fromEntries(new FormData(form))),
                });
                const answer = await response.json().catch(() => ({}));
                if (response.ok && answer.ok) {
                    form.hidden = true;
                    sent.hidden = false;
                    sent.focus();
                    return;
                }
                const control = typeof answer.field === 'string' ? form.elements.namedItem(answer.field) : null;
                if (control && typeof answer.error === 'string') {
                    mark(control, answer.error);
                    tell('One field needs your attention.');
                    control.focus();
                } else {
                    // Only "too many requests" and "could not store" are written for a visitor.
                    const told = (response.status === 429 || response.status === 503) && typeof answer.error === 'string';
                    tell(told ? answer.error : FAILED);
                }
            } catch {
                tell(FAILED);
            } finally {
                button.disabled = false;
                button.textContent = label;
            }
        });
    }

    /**
     * The hero: while the visitor scrolls through it, the product window
     * flattens and leaves, a driver's phone takes the application (choice, CDL
     * photo, reading, step 1 filled, offline, sent), the application's steps
     * float beside it and gather into the team's Applications list.
     */
    function setUpStory() {
        const hero = byId('hero');
        const grid = byId('grid');
        const intro = byId('intro');
        const preview = byId('preview');
        const pv = byId('pv');
        const caps = byId('caps');
        const phone = byId('phone');
        const desk = byId('desk');
        const rail = byId('rail');
        const captions = all('.cap', caps);
        const chips = all('.chip', hero);
        const fields = all('.fld[data-val]', phone);
        const size = { phone: 0, capsRight: 0 };
        let view = '';
        let snapped = false;
        let last = -1;

        function progress() {
            const total = hero.offsetHeight - window.innerHeight;
            if (total <= 0) return 1;
            return clamp(-hero.getBoundingClientRect().top / total, 0, 1);
        }

        function fit() {
            size.phone = phone.offsetWidth;
            size.capsRight = caps.getBoundingClientRect().right;
            if (size.phone) phone.style.setProperty('--ps', ((size.phone - 18) / 262).toFixed(4));
            last = -1;
        }

        function gatherChips(p, width, height) {
            const come = ease(seg(p, 0.2, 0.3));
            const gather = ease(seg(p, 0.8, 0.92));
            const chipWidth = 206;
            const deskWidth = Math.min(460, width * 0.35);
            const deskX = width - Math.max(28, width * 0.05) - deskWidth / 2;
            chips.forEach((chip) => {
                const left = chip.classList.contains('l');
                const offset = Number(chip.dataset.o);
                const x = left ? width / 2 - size.phone / 2 - chipWidth - 14 - offset : width / 2 + size.phone / 2 + 20 + offset;
                const y = height / 2 + Number(chip.dataset.y) - 28;
                if (left && x < size.capsRight + 16) {
                    chip.style.opacity = '0';
                    return;
                }
                const drift = (p - 0.55) * Number(chip.dataset.f) * 90;
                const toX = (deskX - x - chipWidth / 2) * gather;
                const toY = (height / 2 - y - 20) * gather;
                chip.style.opacity = (come * (1 - gather)).toFixed(3);
                chip.style.zIndex = gather > 0 ? '4' : '2';
                chip.style.transform = `translate(${x + toX}px, ${y + toY + drift + (1 - come) * 30}px) scale(${1 - 0.5 * gather})`;
            });
        }

        function render() {
            const p = progress();
            if (p === last) return;
            last = p;
            const small = narrow.matches;
            const width = window.innerWidth;
            const height = window.innerHeight;

            grid.style.transform = `translateY(${-p * 120}px)`;

            const leave = seg(p, 0, 0.07);
            intro.style.opacity = (1 - leave).toFixed(3);
            intro.style.transform = `translateY(${-70 * leave}px)`;
            intro.style.pointerEvents = leave > 0.5 ? 'none' : '';
            intro.style.visibility = leave >= 1 ? 'hidden' : '';

            const flat = ease(seg(p, 0, 0.1));
            const away = ease(seg(p, 0.1, 0.17));
            const topStart = small ? height * 0.73 : height * 0.68;
            const top = topStart + (height * 0.2 - topStart) * flat;
            preview.style.opacity = (1 - away).toFixed(3);
            preview.style.transform = `translate(-50%, ${top}px) scale(${1 - 0.18 * away})`;
            preview.style.visibility = away >= 1 ? 'hidden' : '';
            pv.style.transform = `rotateX(${32 * (1 - flat)}deg)`;

            caps.style.opacity = seg(p, 0.15, 0.21).toFixed(3);
            const step = p < 0.36 ? 0 : p < 0.6 ? 1 : p < 0.82 ? 2 : 3;
            captions.forEach((caption, i) => caption.classList.toggle('on', i === step));

            const enter = ease(seg(p, 0.1, 0.22));
            const aside = ease(seg(p, 0.8, 0.9));
            let x = 0;
            let y = (1 - enter) * 110;
            let scale;
            if (small) {
                y -= aside * 16;
                scale = 1 - 0.3 * aside;
            } else {
                x = -aside * Math.min(width * 0.06, 90);
                scale = 1 - 0.08 * aside;
            }
            phone.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}vh)) scale(${scale})`;
            const next = p < 0.36 ? 'choice' : p < 0.42 ? 'cam' : p < 0.47 ? 'read' : p < 0.71 ? 'form' : p < 0.82 ? 'wait' : 'sent';
            if (next !== view) {
                phone.dataset.v = next;
                view = next;
            }
            phone.classList.toggle('pick', p > 0.3 && p < 0.36);
            if (next === 'cam' && p > 0.39 && !snapped) {
                snapped = true;
                replay(phone, 'snap');
            }
            if (p < 0.37) snapped = false;
            const typed = seg(p, 0.475, 0.54);
            fields.forEach((field, i) => {
                const share = clamp(typed * fields.length - i, 0, 1);
                const value = field.dataset.val;
                field.firstElementChild.textContent = value.slice(0, Math.round(value.length * share));
                field.classList.toggle('done', share >= 1);
            });
            phone.dataset.toast = p >= 0.54 && p < 0.61 ? '1' : '0';
            phone.dataset.net = p >= 0.61 && p < 0.82 ? 'off' : 'on';

            const arrive = ease(seg(p, 0.82, 0.93));
            desk.style.opacity = arrive.toFixed(3);
            desk.style.transform = small ? `translateY(${(1 - arrive) * 140}%)` : `translate(${(1 - arrive) * 130}%, -50%)`;
            desk.classList.toggle('arrive', p > 0.92);

            if (!small) gatherChips(p, width, height);
            rail.style.transform = `scaleY(${p})`;
        }

        fit();
        return { fit, render };
    }

    /**
     * What it does: on a wide screen the step nearest the middle of the window
     * lights up and its card plays on the sticky stage beside the steps; on a
     * phone each card sits under its step and plays once it scrolls in.
     */
    function setUpWorkflow() {
        const steps = all('.wf-step');
        const cards = all('.wc');
        const stage = byId('wfStage');
        let current = -1;

        function aim(card) {
            const cursor = card.querySelector('.cursor');
            const target = card.querySelector('[data-target]');
            if (!cursor || !target) return;
            const box = card.getBoundingClientRect();
            const spot = target.getBoundingClientRect();
            if (!box.width) return;
            cursor.style.setProperty('--cx', `${spot.left - box.left + spot.width * 0.55}px`);
            cursor.style.setProperty('--cy', `${spot.top - box.top + spot.height * 0.5}px`);
        }
        function play(card) {
            aim(card);
            replay(card, 'on');
        }
        function place() {
            current = -1;
            cards.forEach((card, i) => {
                const home = narrow.matches ? steps[i] : stage;
                if (card.parentNode === home) return;
                card.classList.remove('on');
                home.appendChild(card);
            });
        }
        function update() {
            if (narrow.matches) {
                cards.forEach((card) => {
                    if (card.classList.contains('on')) return;
                    const box = card.getBoundingClientRect();
                    if (box.top < window.innerHeight * 0.8 && box.bottom > 0) play(card);
                });
                return;
            }
            const middle = window.innerHeight / 2;
            let nearest = 0;
            let distance = Infinity;
            steps.forEach((step, i) => {
                const box = step.getBoundingClientRect();
                const away = Math.abs(box.top + box.height / 2 - middle);
                if (away < distance) {
                    distance = away;
                    nearest = i;
                }
            });
            if (nearest === current) return;
            current = nearest;
            steps.forEach((step, i) => step.classList.toggle('on', i === nearest));
            cards.forEach((card, i) => {
                if (i === nearest) play(card);
                else card.classList.remove('on');
            });
        }

        // The pointer taps once it reaches its button.
        all('.cursor').forEach((cursor) => cursor.addEventListener('animationend', (event) => {
            if (event.pseudoElement || !event.animationName.startsWith('cur')) return;
            replay(cursor, 'ripple');
        }));
        place();
        return { place, update };
    }

    /** Headings rise word by word, sections fade up, numbers count, once each. */
    function setUpReveals() {
        all('[data-words]').forEach((heading) => {
            const words = heading.textContent.trim().split(/\s+/);
            heading.textContent = '';
            words.forEach((word, i) => {
                const span = document.createElement('span');
                span.className = 'w';
                span.style.transitionDelay = `${i * 55}ms`;
                span.textContent = word;
                heading.append(span, i < words.length - 1 ? ' ' : '');
            });
        });
        const counters = all('[data-count]');
        counters.forEach((counter) => { counter.textContent = '0'; });

        function count(counter) {
            const to = Number(counter.dataset.count);
            let start = null;
            const frame = (time) => {
                if (start === null) start = time;
                const done = clamp((time - start) / 1100, 0, 1);
                counter.textContent = String(Math.round(to * ease(done)));
                if (done < 1) requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        }

        const seen = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('in');
                if (entry.target.dataset.count !== undefined) count(entry.target);
                seen.unobserve(entry.target);
            });
        }, { threshold: 0.18 });
        all('.rv, .words').concat(counters).forEach((element) => seen.observe(element));

        // A looping picture plays only while it is on screen.
        const loops = new IntersectionObserver((entries) => {
            entries.forEach((entry) => entry.target.classList.toggle('playing', entry.isIntersecting));
        });
        all('[data-loop]').forEach((element) => loops.observe(element));
    }

    document.addEventListener('DOMContentLoaded', () => {
        const nav = byId('nav');
        const updateNav = () => nav.classList.toggle('clear', window.scrollY <= 10);
        setUpContactForm();

        if (!motion) {
            window.addEventListener('scroll', updateNav, { passive: true });
            updateNav();
            return;
        }

        const story = setUpStory();
        const workflow = setUpWorkflow();
        setUpReveals();

        let queued = false;
        const frame = () => {
            queued = false;
            updateNav();
            story.render();
            workflow.update();
        };
        const schedule = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(frame);
        };
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', () => {
            story.fit();
            workflow.place();
            schedule();
        });
        frame();
    });
})();
