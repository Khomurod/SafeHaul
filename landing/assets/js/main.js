/**
 * SafeHaul landing page interactions.
 * Lead delivery is same-origin; credentials remain in Firebase Secret Manager.
 */

document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.getElementById('navbar');
    const mobileToggle = document.getElementById('mobileMenuToggle');
    const navLinks = document.getElementById('navLinks');

    window.addEventListener('scroll', () => {
        navbar.style.boxShadow = window.scrollY > 50 ? '0 2px 10px rgba(0,0,0,0.1)' : 'none';
    });

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            mobileToggle.classList.toggle('active');
        });
    }

    const faqRows = document.querySelectorAll('.faq-row');
    faqRows.forEach((row) => {
        const question = row.querySelector('.faq-question');
        question.addEventListener('click', () => {
            faqRows.forEach((otherRow) => {
                if (otherRow !== row) {
                    otherRow.classList.remove('active');
                    otherRow.querySelector('.indicator').textContent = '+';
                }
            });

            const isActive = row.classList.contains('active');
            row.classList.toggle('active', !isActive);
            question.querySelector('.indicator').textContent = isActive ? '+' : '-';
        });
    });

    const modalButtons = document.querySelectorAll('.js-open-lead-modal');
    const modalOverlay = document.getElementById('leadModal');
    const closeModalBtn = document.getElementById('closeModal');
    const closeSuccessBtn = document.getElementById('successClose');
    const leadForm = document.getElementById('leadForm');
    const successMessage = document.getElementById('successMessage');
    let returnFocus = null;

    const openModal = (trigger) => {
        returnFocus = trigger || document.activeElement;
        modalOverlay.classList.add('active');
        modalOverlay.setAttribute('aria-hidden', 'false');
        leadForm.style.display = 'block';
        successMessage.style.display = 'none';
        closeModalBtn.focus();
    };

    const closeModal = () => {
        modalOverlay.classList.remove('active');
        modalOverlay.setAttribute('aria-hidden', 'true');
        if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
    };

    modalButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            openModal(button);
        });
    });

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (closeSuccessBtn) closeSuccessBtn.addEventListener('click', closeModal);

    modalOverlay.addEventListener('click', (event) => {
        if (event.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modalOverlay.classList.contains('active')) closeModal();
    });

    const checkHash = () => {
        if (window.location.hash === '#get-started') openModal(null);
    };
    checkHash();
    window.addEventListener('hashchange', checkHash);

    if (leadForm) {
        leadForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const button = leadForm.querySelector('button[type="submit"]');
            const originalText = button.textContent;
            button.textContent = 'Sending...';
            button.disabled = true;

            const data = Object.fromEntries(new FormData(leadForm).entries());

            try {
                const response = await fetch('/api/landing-lead', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });

                if (!response.ok) throw new Error('Request could not be sent.');

                leadForm.style.display = 'none';
                successMessage.style.display = 'block';
                leadForm.reset();
                closeSuccessBtn.focus();
            } catch (error) {
                console.error('Submission error:', error.message);
                alert('Failed to send request. Please try again later or email info@safehaul.io.');
            } finally {
                button.textContent = originalText;
                button.disabled = false;
            }
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
                var img = document.createElement('img');
                img.src = post.image.url;
                // Descriptive alt text is stored with the image; fall back to
                // the title rather than leaving it empty.
                img.alt = post.image.altText || post.title;
                img.loading = 'lazy';
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
            readMore.textContent = 'Read Article';
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
