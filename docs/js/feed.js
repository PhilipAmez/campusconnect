document.addEventListener("DOMContentLoaded", function() {
    document.querySelectorAll('video').forEach(video => {
        video.addEventListener('waiting', () => video.parentElement.querySelector('.loading-overlay').style.display = 'flex');
    });
});