export const socket = io('https://campusconnect-omep.onrender.com', { autoConnect: false });

export function setupSocketEvents(groupId, currentUser, onMessage, onTyping) {
  socket.connect();

  socket.on('connect', () => {
    socket.emit('join_group', groupId, currentUser.name);
  });

  socket.on('new_message', onMessage);

  socket.on('user_typing', (user) => {
    if (onTyping) onTyping(user);
  });

  socket.on('user_joined', (user) => {
    console.log(`${user} joined the group`);
  });

  socket.on('disconnect', () => {
    console.warn('⚠️ Disconnected from chat server.');
  });

  socket.io.on('reconnect', () => {
    console.log('✅ Reconnected to chat server');
    socket.emit('join_group', groupId, currentUser.name);
  });
}

export function emitTyping(groupId, user) {
  socket.emit('typing', { groupId, user });
}

