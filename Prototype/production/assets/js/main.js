/**
 * SafeHaul landing page interactions.
 *
 * Plain ES5-compatible browser JavaScript: no framework, no build step, no
 * dependency. Six responsibilities:
 *
 *   1. navigation (sticky state, mobile panel, the current-section rule)
 *   2. reveals — sections, the hero assembly, the activity board
 *   3. the FAQ accordion
 *   4. the two-step lead modal
 *   5. the inline closing-CTA form, which shares the modal's step-one path
 *   6. the News & Insights card strip
 *
 * Every reveal is decoration over content that is already in the document, and
 * every one is skipped under `prefers-reduced-motion` or when
 * IntersectionObserver is missing. Nothing on this page needs a script to be
 * readable.
 *
 * Two rules run through all of it:
 *
 *   - **Nothing fetched is ever treated as markup.** Every value from
 *     `/api/news/latest` is inserted with `textContent` or `setAttribute`. The
 *     endpoint escapes its own output, but this page must not depend on that.
 *   - **Credentials never appear here.** Lead delivery is same-origin to
 *     `/api/landing-lead`; the Telegram token lives server-side only.
 */

document.addEventListener('DOMContentLoaded', function () {
    /* ====================================================================== */
    /* Navigation                                                             */
    /* ====================================================================== */

    var navbar = document.getElementById('navbar');
    var mobileToggle = document.getElementById('mobileMenuToggle');
    var navLinks = document.getElementById('navLinks');

    if (navbar) {
        // A data attribute rather than an inline style, so the border and the
        // shadow stay described in the stylesheet where the rest of the design
        // lives.
        var applyScrollState = function () {
            navbar.setAttribute('data-scrolled', window.scrollY > 8 ? 'true' : 'false');
        };
        applyScrollState();
        window.addEventListener('scroll', applyScrollState, { passive: true });
    }

    /*
     * The current-section rule.
     *
     * The link for the section being read carries a drawn 2px underline, so the
     * navigation says where in the specification you are. `aria-current` carries
     * it, which means the state is announced rather than merely drawn.
     *
     * Guarded on both sides: the server-rendered blog emits this same navbar
     * with off-page links and no sections to observe, and older browsers
     * without IntersectionObserver simply keep the rail static.
     */
    if (navLinks && 'IntersectionObserver' in window) {
        var tabs = [];
        var linkByHash = {};
        Array.prototype.forEach.call(navLinks.querySelectorAll('.nav-link'), function (link) {
            var href = link.getAttribute('href') || '';
            if (href.charAt(0) !== '#' || href.length < 2) return;
            var id = href.slice(1);
            linkByHash[id] = link;
            var section = document.getElementById(id);
            if (section) tabs.push({ link: link, section: section });
        });

        // Sections that belong to a link without being its anchor: the Apply /
        // Sign / Verify story blocks carry `data-tab="features"`, so the Platform
        // link stays underlined while they are read instead of the rule going
        // inert across the middle of the page. No-op on the blog, which emits
        // neither.
        Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (section) {
            var link = linkByHash[section.getAttribute('data-tab')];
            if (link) tabs.push({ link: link, section: section });
        });

        if (tabs.length > 0) {
            var visible = [];

            var paintActiveTab = function () {
                var current = null;
                // The topmost section still in view wins, so scrolling past the
                // end of one section hands the tab to the next rather than to
                // whichever observer happened to fire last.
                visible.forEach(function (entry) {
                    if (!current || entry.section.offsetTop < current.section.offsetTop) current = entry;
                });
                // Key on the link, not the entry: several sections can map to one
                // tab, and all of them must resolve to the same lit tab rather
                // than the last one processed winning.
                var activeLink = current ? current.link : null;
                tabs.forEach(function (entry) {
                    if (entry.link === activeLink) {
                        entry.link.setAttribute('aria-current', 'true');
                    } else {
                        entry.link.removeAttribute('aria-current');
                    }
                });
            };

            var tabObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    var match = null;
                    tabs.forEach(function (candidate) {
                        if (candidate.section === entry.target) match = candidate;
                    });
                    if (!match) return;
                    var index = visible.indexOf(match);
                    if (entry.isIntersecting && index === -1) visible.push(match);
                    if (!entry.isIntersecting && index !== -1) visible.splice(index, 1);
                });
                paintActiveTab();
            }, { rootMargin: '-96px 0px -55% 0px', threshold: 0 });

            tabs.forEach(function (entry) { tabObserver.observe(entry.section); });
        }
    }

    if (mobileToggle && navLinks) {
        var setMenuOpen = function (open) {
            navLinks.classList.toggle('active', open);
            mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            mobileToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        };

        mobileToggle.addEventListener('click', function () {
            setMenuOpen(mobileToggle.getAttribute('aria-expanded') !== 'true');
        });

        // Following a link should close the panel it was tapped in.
        navLinks.addEventListener('click', function (event) {
            if (event.target.closest('a')) setMenuOpen(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && mobileToggle.getAttribute('aria-expanded') === 'true') {
                setMenuOpen(false);
                mobileToggle.focus();
            }
        });
    }

    /* ====================================================================== */
    /* Reveals — "parts seat into position"                                    */
    /*                                                                        */
    /* One motion grammar for the whole site. Everything below is additive:    */
    /* the CSS only hides a `[data-reveal]` element inside a                   */
    /* `prefers-reduced-motion: no-preference` block, so with motion reduced,  */
    /* with JavaScript off, or on a browser without IntersectionObserver, the  */
    /* page is simply the finished page.                                       */
    /* ====================================================================== */

    var prefersReducedMotion = function () {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    };
    var canObserve = 'IntersectionObserver' in window && !prefersReducedMotion();

    /**
     * Marks each `[data-reveal]` once and then stops watching it.
     *
     * Fires once by design: an element that re-animates every time it scrolls
     * back into view is an element that draws attention to the animation rather
     * than to what it says.
     */
    var revealTargets = document.querySelectorAll('[data-reveal]');

    if (revealTargets.length > 0) {
        if (!canObserve) {
            Array.prototype.forEach.call(revealTargets, function (element) {
                element.setAttribute('data-revealed', 'true');
            });
        } else {
            var revealObserver = new IntersectionObserver(function (entries, observer) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    entry.target.setAttribute('data-revealed', 'true');
                    observer.unobserve(entry.target);
                });
            }, { threshold: 0.2 });

            Array.prototype.forEach.call(revealTargets, function (element) {
                // A section taller than the viewport can never reach a 0.2 ratio,
                // so it would sit invisible forever. Those reveal immediately.
                if (element.getBoundingClientRect().height > window.innerHeight * 0.8) {
                    element.setAttribute('data-revealed', 'true');
                    return;
                }
                revealObserver.observe(element);
            });
        }
    }

    /*
     * The hero assembly.
     *
     * Runs once on load, not on scroll: it is the first viewport, so there is
     * nothing to wait for. The plates seat into their exploded positions — they
     * do not collapse into the base plate, because the exploded arrangement is
     * the figure. Under reduced motion the seated state is applied immediately.
     */
    var heroFigure = document.getElementById('figureOne');

    if (heroFigure) {
        if (!canObserve) {
            heroFigure.classList.add('f1-seated');
        } else {
            // One frame, so the browser has painted the unseated state and has
            // something to transition from.
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(function () {
                    heroFigure.classList.add('f1-seated');
                });
            });
        }
    }

    /*
     * The activity board.
     *
     * Cells appear left to right at 24ms, so the record reads as something that
     * accumulated rather than something that was drawn all at once. The delay is
     * set per cell rather than with nth-child, because the number of columns
     * changes at 768px.
     */
    var activityBoard = document.getElementById('activityBoard');

    if (activityBoard) {
        var boardCells = activityBoard.querySelectorAll('.board-row > span');

        var cascadeBoard = function () {
            Array.prototype.forEach.call(boardCells, function (cell, index) {
                cell.style.transitionDelay = (index * 24) + 'ms';
            });
            activityBoard.setAttribute('data-cascaded', 'true');
        };

        if (!canObserve) {
            activityBoard.setAttribute('data-cascaded', 'true');
        } else {
            var boardObserver = new IntersectionObserver(function (entries, observer) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting) return;
                    observer.disconnect();
                    cascadeBoard();
                });
            }, { threshold: 0.3 });
            boardObserver.observe(activityBoard);
        }
    }

    /*
     * Scrollable figures: keep the tab stop only where it does something.
     *
     * The wide drawings ship `tabindex="0"` in the markup, because a scroll region
     * a keyboard cannot reach is a region a keyboard user cannot read — and that
     * has to hold with JavaScript off. Above the width where they overflow,
     * though, the stop leads nowhere: four dead stops in the middle of the page.
     * So the enhancement only ever REMOVES a stop, never adds one, which is the
     * safe direction for this to fail in.
     */
    var scrollFigures = document.querySelectorAll('.figure-scroll');

    if (scrollFigures.length > 0) {
        var syncFigureTabStops = function () {
            Array.prototype.forEach.call(scrollFigures, function (figure) {
                // 2px of slack: sub-pixel layout can leave scrollWidth a hair
                // over clientWidth on a figure that is not really clipped.
                if (figure.scrollWidth - figure.clientWidth > 2) {
                    figure.setAttribute('tabindex', '0');
                } else {
                    figure.removeAttribute('tabindex');
                }
            });
        };

        syncFigureTabStops();

        var figureResizeTimer = null;
        window.addEventListener('resize', function () {
            window.clearTimeout(figureResizeTimer);
            figureResizeTimer = window.setTimeout(syncFigureTabStops, 150);
        }, { passive: true });
    }

    /* ====================================================================== */
    /* FAQ accordion                                                          */
    /*                                                                        */
    /* Each question is a real <button> with aria-expanded, and each answer is */
    /* toggled with the `hidden` attribute. The previous implementation was a  */
    /* <div> with a click listener, which meant no keyboard user could open    */
    /* any answer on the page at all.                                          */
    /* ====================================================================== */

    var faqButtons = document.querySelectorAll('.faq-question');

    Array.prototype.forEach.call(faqButtons, function (button) {
        button.addEventListener('click', function () {
            var expanded = button.getAttribute('aria-expanded') === 'true';

            // Single-open accordion: close the others first.
            Array.prototype.forEach.call(faqButtons, function (other) {
                if (other === button) return;
                other.setAttribute('aria-expanded', 'false');
                var otherAnswer = document.getElementById(other.getAttribute('aria-controls'));
                if (otherAnswer) otherAnswer.hidden = true;
            });

            button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
            var answer = document.getElementById(button.getAttribute('aria-controls'));
            if (answer) answer.hidden = expanded;
        });
    });

    /* ====================================================================== */
    /* The nine steps                                                         */
    /*                                                                        */
    /* The page's one authored moment. The claim beside it is that work in     */
    /* progress survives a dropped connection, so the steps complete one after */
    /* another and every completed one stays marked — which is the difference  */
    /* between a form that queues and a form that resets.                      */
    /* ====================================================================== */

    var stepsList = document.getElementById('applicationSteps');

    if (stepsList) {
        var stepItems = stepsList.querySelectorAll('li');
        var reduceMotion = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        var markAllSteps = function () {
            Array.prototype.forEach.call(stepItems, function (item) {
                item.setAttribute('data-done', 'true');
            });
        };

        if (reduceMotion || !('IntersectionObserver' in window)) {
            markAllSteps();
        } else {
            var stepsRun = false;
            var stepsObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (!entry.isIntersecting || stepsRun) return;
                    stepsRun = true;
                    stepsObserver.disconnect();
                    Array.prototype.forEach.call(stepItems, function (item, index) {
                        window.setTimeout(function () {
                            item.setAttribute('data-done', 'true');
                        }, 90 * index);
                    });
                });
            }, { threshold: 0.4 });
            stepsObserver.observe(stepsList);
        }
    }

    /* ====================================================================== */
    /* Shared lead-form plumbing                                              */
    /*                                                                        */
    /* Two surfaces capture the same step-one lead: the dialog and the inline  */
    /* form in the closing band. They share this validation, this payload and  */
    /* this endpoint rather than each growing its own copy — two lead paths    */
    /* that drift apart is two lead paths where one quietly stops working.     */
    /* ====================================================================== */

    var clearFieldError = function (input) {
        var error = document.getElementById(input.id + 'Error');
        input.removeAttribute('aria-invalid');
        if (error) {
            error.textContent = '';
            error.hidden = true;
        }
    };

    var setFieldError = function (input, message) {
        var error = document.getElementById(input.id + 'Error');
        input.setAttribute('aria-invalid', 'true');
        if (error) {
            error.textContent = message;
            error.hidden = false;
        }
    };

    /** Validates one step or form, focusing the first field that failed. */
    var validateStep = function (fieldset) {
        var inputs = fieldset.querySelectorAll('input[required], select[required]');
        var firstInvalid = null;

        Array.prototype.forEach.call(inputs, function (input) {
            clearFieldError(input);
            var value = String(input.value || '').trim();

            if (!value) {
                setFieldError(input, 'This field is required.');
                if (!firstInvalid) firstInvalid = input;
                return;
            }

            if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                setFieldError(input, 'Enter a valid email address.');
                if (!firstInvalid) firstInvalid = input;
            }
        });

        if (firstInvalid) {
            firstInvalid.focus();
            return false;
        }
        return true;
    };

    /** Attribution, read from the URL rather than stored in a cookie. */
    var attribution = function () {
        var params = new URLSearchParams(window.location.search);
        return {
            sourcePage: window.location.pathname,
            referrer: document.referrer || '',
            utmSource: params.get('utm_source') || '',
            utmMedium: params.get('utm_medium') || '',
            utmCampaign: params.get('utm_campaign') || ''
        };
    };

    var postLead = function (payload) {
        return fetch('/api/landing-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (response) {
            if (!response.ok) throw new Error('Request failed');
            return response.json();
        });
    };

    var withPendingButton = function (button, label, work) {
        var original = button.textContent;
        button.textContent = label;
        button.disabled = true;
        return work().then(
            function (value) {
                button.textContent = original;
                button.disabled = false;
                return value;
            },
            function (error) {
                button.textContent = original;
                button.disabled = false;
                throw error;
            }
        );
    };

    /* ====================================================================== */
    /* Lead modal                                                             */
    /* ====================================================================== */

    var modalOverlay = document.getElementById('leadModal');
    var modalButtons = document.querySelectorAll('.js-open-lead-modal');

    if (modalOverlay) {
        var closeModalBtn = document.getElementById('closeModal');
        var closeSuccessBtn = document.getElementById('successClose');
        var leadForm = document.getElementById('leadForm');
        var successMessage = document.getElementById('successMessage');
        var stepOne = document.getElementById('stepOne');
        var stepTwo = document.getElementById('stepTwo');
        var stepLabel = document.getElementById('modalStep');
        var modalSubtitle = document.getElementById('modalSubtitle');
        var formStatus = document.getElementById('formStatus');
        var skipButton = document.getElementById('skipStepTwo');
        var returnFocus = null;
        // The opaque handle the server issues at step one. It authorises exactly
        // one completion of exactly one lead and nothing else, so holding it in
        // a closure is sufficient — it is not written to storage or the URL.
        var leadReference = null;

        var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

        var visibleFocusable = function () {
            return Array.prototype.filter.call(
                modalOverlay.querySelectorAll(FOCUSABLE),
                function (element) {
                    return element.offsetParent !== null;
                }
            );
        };

        /**
         * Keeps Tab inside the dialog while it is open.
         *
         * Without this the dialog is `aria-modal` in name only: Tab walks
         * straight out into the page behind it, which a screen-reader or
         * keyboard user experiences as the dialog silently ceasing to exist.
         */
        var trapFocus = function (event) {
            if (event.key !== 'Tab') return;
            var items = visibleFocusable();
            if (items.length === 0) return;

            var first = items[0];
            var last = items[items.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        var setStatus = function (message, tone) {
            if (!formStatus) return;
            formStatus.textContent = message || '';
            if (tone) {
                formStatus.setAttribute('data-tone', tone);
            } else {
                formStatus.removeAttribute('data-tone');
            }
        };

        var showStepTwo = function () {
            stepOne.hidden = true;
            stepTwo.hidden = false;
            if (stepLabel) stepLabel.textContent = 'Step 2 of 2';
            if (modalSubtitle) {
                modalSubtitle.textContent = 'Your details are saved. This part just helps us prepare.';
            }
            setStatus('');
            var firstField = stepTwo.querySelector('input, select');
            if (firstField) firstField.focus();
        };

        var showSuccess = function () {
            leadForm.hidden = true;
            successMessage.hidden = false;
            if (stepLabel) stepLabel.hidden = true;
            if (closeSuccessBtn) closeSuccessBtn.focus();
        };

        var resetModal = function () {
            leadForm.hidden = false;
            successMessage.hidden = true;
            stepOne.hidden = false;
            stepTwo.hidden = true;
            leadForm.reset();
            leadReference = null;
            setStatus('');
            if (stepLabel) {
                stepLabel.hidden = false;
                stepLabel.textContent = 'Step 1 of 2';
            }
            if (modalSubtitle) {
                modalSubtitle.textContent = 'Two fields now. The rest only helps us prepare.';
            }
            Array.prototype.forEach.call(leadForm.querySelectorAll('input, select'), clearFieldError);
        };

        var openModal = function (trigger) {
            returnFocus = trigger || document.activeElement;
            modalOverlay.classList.add('active');
            modalOverlay.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            document.addEventListener('keydown', trapFocus);

            // Only start over if the visitor never got anywhere. Reopening after
            // a completed step one should not discard it.
            if (!leadReference && successMessage.hidden) resetModal();

            // Deferred by a frame on purpose. The overlay animates from
            // `visibility: hidden`, and an element that is still hidden at the
            // moment `focus()` is called does not take focus — which would
            // leave the keyboard on the trigger behind the overlay, making the
            // dialog `aria-modal` in name only.
            window.requestAnimationFrame(function () {
                var firstField = document.getElementById('fullName');
                if (firstField && !stepOne.hidden) {
                    firstField.focus();
                } else if (closeModalBtn) {
                    closeModalBtn.focus();
                }
            });
        };

        var closeModal = function () {
            modalOverlay.classList.remove('active');
            modalOverlay.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            document.removeEventListener('keydown', trapFocus);
            if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
        };

        Array.prototype.forEach.call(modalButtons, function (button) {
            button.addEventListener('click', function (event) {
                event.preventDefault();
                openModal(button);
            });
        });

        if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
        if (closeSuccessBtn) closeSuccessBtn.addEventListener('click', closeModal);

        modalOverlay.addEventListener('click', function (event) {
            if (event.target === modalOverlay) closeModal();
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && modalOverlay.classList.contains('active')) closeModal();
        });

        var checkHash = function () {
            if (window.location.hash === '#get-started') openModal(null);
        };
        checkHash();
        window.addEventListener('hashchange', checkHash);

        leadForm.addEventListener('submit', function (event) {
            event.preventDefault();
            var context = attribution();

            if (!stepOne.hidden) {
                if (!validateStep(stepOne)) return;
                var stepOneButton = document.getElementById('stepOneSubmit');

                withPendingButton(stepOneButton, 'Sending…', function () {
                    return postLead({
                        step: 1,
                        fullName: document.getElementById('fullName').value,
                        workEmail: document.getElementById('workEmail').value,
                        website: document.getElementById('website').value,
                        sourcePage: context.sourcePage,
                        referrer: context.referrer,
                        utmSource: context.utmSource,
                        utmMedium: context.utmMedium,
                        utmCampaign: context.utmCampaign
                    });
                }).then(function (data) {
                    leadReference = (data && data.reference) || null;
                    showStepTwo();
                }).catch(function () {
                    setStatus('We could not send that. Email info@safehaul.io and we will pick it up.', 'error');
                });
                return;
            }

            if (!validateStep(stepTwo)) return;
            var stepTwoButton = document.getElementById('stepTwoSubmit');

            withPendingButton(stepTwoButton, 'Sending…', function () {
                return postLead({
                    step: 2,
                    reference: leadReference,
                    companyName: document.getElementById('companyName').value,
                    companySize: document.getElementById('companySize').value,
                    phone: document.getElementById('phone').value,
                    primaryGoal: document.getElementById('primaryGoal').value
                });
            }).then(function () {
                showSuccess();
            }).catch(function () {
                // Step one already reached a human, so this is genuinely not
                // worth making the visitor anxious about.
                showSuccess();
            });
        });

        if (skipButton) {
            skipButton.addEventListener('click', function () {
                showSuccess();
            });
        }
    }

    /* ====================================================================== */
    /* The inline closing-CTA form                                            */
    /*                                                                        */
    /* The same step-one payload the dialog posts, on the page rather than     */
    /* behind a click. On success the form is replaced in place by a short     */
    /* confirmation: no dialog opens, nothing scrolls, and the visitor is left */
    /* where they were. Errors are reported inline — never through `alert`.    */
    /* ====================================================================== */

    var ctaForm = document.getElementById('ctaForm');
    var ctaDone = document.getElementById('ctaDone');

    if (ctaForm && ctaDone) {
        var ctaStatus = document.getElementById('ctaStatus');
        var ctaSubmit = document.getElementById('ctaSubmit');

        ctaForm.addEventListener('submit', function (event) {
            event.preventDefault();
            if (!validateStep(ctaForm)) return;
            if (ctaStatus) ctaStatus.textContent = '';

            var context = attribution();

            withPendingButton(ctaSubmit, 'Sending…', function () {
                return postLead({
                    step: 1,
                    fullName: document.getElementById('ctaFullName').value,
                    workEmail: document.getElementById('ctaWorkEmail').value,
                    website: document.getElementById('ctaWebsite').value,
                    sourcePage: context.sourcePage,
                    referrer: context.referrer,
                    utmSource: context.utmSource,
                    utmMedium: context.utmMedium,
                    utmCampaign: context.utmCampaign
                });
            }).then(function () {
                ctaForm.hidden = true;
                ctaDone.hidden = false;
                // The confirmation replaces a form the keyboard was inside, so
                // focus has to follow it or it lands back at the top of the page.
                ctaDone.setAttribute('tabindex', '-1');
                ctaDone.focus();
            }).catch(function () {
                if (ctaStatus) {
                    ctaStatus.textContent =
                        'We could not send that. Email info@safehaul.io and we will pick it up.';
                    ctaStatus.setAttribute('data-tone', 'error');
                }
            });
        });
    }

    /* ======================================================================
       SafeHaul News & Insights — latest article cards
       ----------------------------------------------------------------------
       Articles are published after deployment, so the cards cannot be committed
       to this repository. They are fetched from /api/news/latest, a same-origin
       Firebase Hosting rewrite onto the serveBlogPublic function.

       Every value from that response is inserted with textContent or as an
       attribute via setAttribute — never with innerHTML. The server already
       escapes its own HTML output, but this page must not depend on that: the
       DOM API makes injection impossible here regardless of what the endpoint
       returns.

       If the request fails, the placeholder is replaced with a link to /news
       rather than an error. A marketing page should degrade quietly.
       ====================================================================== */
    var newsGrid = document.getElementById('newsGrid');

    if (newsGrid) {
        var renderNewsFallback = function (message) {
            newsGrid.setAttribute('aria-busy', 'false');
            newsGrid.textContent = '';
            var note = document.createElement('p');
            note.className = 'news-empty';
            note.textContent = message;
            var link = document.createElement('a');
            link.href = '/news';
            link.className = 'news-read-more';
            link.textContent = 'Visit News & Insights';
            note.appendChild(document.createElement('br'));
            note.appendChild(link);
            newsGrid.appendChild(note);
        };

        var buildNewsCard = function (post) {
            var card = document.createElement('article');
            card.className = 'news-card';

            if (post.image && post.image.url) {
                var imageLink = document.createElement('a');
                imageLink.className = 'news-card-image';
                imageLink.href = post.url;
                // The image is decorative next to the headline link that
                // follows it, so it is hidden from the accessibility tree
                // rather than announced as a second link to the same article.
                imageLink.setAttribute('tabindex', '-1');
                imageLink.setAttribute('aria-hidden', 'true');
                var img = document.createElement('img');
                img.src = post.image.url;
                // Descriptive alt text is stored with the image; fall back to
                // the title rather than leaving it empty.
                img.alt = post.image.altText || post.title;
                img.loading = 'lazy';
                img.decoding = 'async';
                imageLink.appendChild(img);
                card.appendChild(imageLink);
            }

            var body = document.createElement('div');
            body.className = 'news-card-body';

            if (post.themeName) {
                var eyebrow = document.createElement('p');
                eyebrow.className = 'news-eyebrow';
                eyebrow.textContent = post.themeName;
                body.appendChild(eyebrow);
            }

            var heading = document.createElement('h3');
            var titleLink = document.createElement('a');
            titleLink.href = post.url;
            titleLink.textContent = post.title;
            heading.appendChild(titleLink);
            body.appendChild(heading);

            if (post.excerpt) {
                var excerpt = document.createElement('p');
                excerpt.className = 'news-card-excerpt';
                excerpt.textContent = post.excerpt;
                body.appendChild(excerpt);
            }

            if (post.publicationDate) {
                var meta = document.createElement('p');
                meta.className = 'news-meta';
                var time = document.createElement('time');
                time.setAttribute('datetime', post.publicationDate);
                // Parsed at UTC noon so the displayed date matches the
                // publication date in every reader's timezone.
                var parsed = new Date(post.publicationDate + 'T12:00:00Z');
                time.textContent = isNaN(parsed.getTime())
                    ? post.publicationDate
                    : parsed.toLocaleDateString('en-US', {
                        year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
                    });
                meta.appendChild(time);
                body.appendChild(meta);
            }

            var readMore = document.createElement('a');
            readMore.className = 'news-read-more';
            readMore.href = post.url;
            readMore.textContent = 'Read article';
            body.appendChild(readMore);

            card.appendChild(body);
            return card;
        };

        fetch('/api/news/latest?limit=3', { headers: { Accept: 'application/json' } })
            .then(function (response) {
                if (!response.ok) throw new Error('Request failed');
                return response.json();
            })
            .then(function (payload) {
                var posts = (payload && Array.isArray(payload.posts)) ? payload.posts : [];
                if (posts.length === 0) {
                    renderNewsFallback('The first articles are on their way.');
                    return;
                }
                newsGrid.textContent = '';
                posts.slice(0, 3).forEach(function (post) {
                    if (post && post.title && post.url) newsGrid.appendChild(buildNewsCard(post));
                });
                newsGrid.setAttribute('aria-busy', 'false');
            })
            .catch(function () {
                renderNewsFallback('Articles could not be loaded right now.');
            });
    }

});
