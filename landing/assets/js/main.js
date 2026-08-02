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
});
