document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll('video').forEach(video => {
        video.addEventListener('waiting', () => {
            const parent = video.parentElement;
            if (!parent) return;
            const overlay = parent.querySelector('.loading-overlay');
            if (overlay && overlay.style) {
                overlay.style.display = 'flex';
            }
        });
    });
});
