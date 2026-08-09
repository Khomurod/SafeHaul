/**
 * SafeHaul landing page interactions.
 *
 * Plain ES5-compatible browser JavaScript: no framework, no build step, no
 * dependency. Four responsibilities:
 *
 *   1. navigation (sticky state, mobile panel)
 *   2. the FAQ accordion
 *   3. the two-step lead modal
 *   4. the News & Insights card strip
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

        /** Validates one step, focusing the first field that failed. */
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
