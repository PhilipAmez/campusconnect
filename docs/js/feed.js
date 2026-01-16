function playNotificationSound() {
    try {
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.5;
        audio.play().catch(error => console.log('Could not play notification sound:', error));
    } catch (error) {
        console.log('Notification sound error:', error);
    }
}
