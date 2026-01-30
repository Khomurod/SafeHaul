import React, { useEffect, useRef, useMemo } from 'react';

/**
 * ParticleField - Animated particle background for Mission Control
 * Creates a subtle, performant starfield effect
 */
const ParticleField = ({
    particleCount = 50,
    color = 'rgba(59, 130, 246, 0.4)',
    minSize = 1,
    maxSize = 3,
    speed = 0.3,
    className = '',
}) => {
    const canvasRef = useRef(null);
    const animationRef = useRef(null);
    const particlesRef = useRef([]);

    // Generate particles with stable positions
    const particles = useMemo(() => {
        return Array.from({ length: particleCount }, () => ({
            x: Math.random() * 100,
            y: Math.random() * 100,
            size: minSize + Math.random() * (maxSize - minSize),
            opacity: 0.2 + Math.random() * 0.6,
            vx: (Math.random() - 0.5) * speed,
            vy: (Math.random() - 0.5) * speed,
            pulse: Math.random() * Math.PI * 2,
        }));
    }, [particleCount, minSize, maxSize, speed]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let width = canvas.offsetWidth;
        let height = canvas.offsetHeight;

        // Set canvas size
        const setSize = () => {
            width = canvas.offsetWidth;
            height = canvas.offsetHeight;
            canvas.width = width * window.devicePixelRatio;
            canvas.height = height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };

        setSize();
        window.addEventListener('resize', setSize);

        // Initialize particles
        particlesRef.current = particles.map(p => ({
            ...p,
            x: (p.x / 100) * width,
            y: (p.y / 100) * height,
        }));

        // Animation loop
        const animate = () => {
            ctx.clearRect(0, 0, width, height);

            particlesRef.current.forEach((particle, i) => {
                // Update position
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.pulse += 0.02;

                // Wrap around edges
                if (particle.x < 0) particle.x = width;
                if (particle.x > width) particle.x = 0;
                if (particle.y < 0) particle.y = height;
                if (particle.y > height) particle.y = 0;

                // Calculate pulsing opacity
                const pulseOpacity = particle.opacity * (0.7 + 0.3 * Math.sin(particle.pulse));

                // Draw particle
                ctx.beginPath();
                ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
                ctx.fillStyle = color.replace(/[\d.]+\)$/, `${pulseOpacity})`);
                ctx.fill();

                // Draw glow for larger particles
                if (particle.size > 2) {
                    const gradient = ctx.createRadialGradient(
                        particle.x, particle.y, 0,
                        particle.x, particle.y, particle.size * 4
                    );
                    gradient.addColorStop(0, color.replace(/[\d.]+\)$/, `${pulseOpacity * 0.3})`));
                    gradient.addColorStop(1, 'transparent');
                    ctx.beginPath();
                    ctx.arc(particle.x, particle.y, particle.size * 4, 0, Math.PI * 2);
                    ctx.fillStyle = gradient;
                    ctx.fill();
                }
            });

            animationRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('resize', setSize);
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [particles, color]);

    return (
        <canvas
            ref={canvasRef}
            className={`absolute inset-0 pointer-events-none ${className}`}
            style={{
                width: '100%',
                height: '100%',
                opacity: 0.6,
            }}
        />
    );
};

export default ParticleField;
