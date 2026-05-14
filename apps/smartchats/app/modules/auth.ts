/**
 * Auth context module — system message varies based on login state
 */

export function createAuthModule(authInfo?: { isAuthenticated: boolean }) {
    return {
        id: 'auth',
        name: 'Auth Context',
        position: 15,
        system_msg: authInfo?.isAuthenticated
            ? 'The user is logged in and has full access to cloud storage and the database backend.'
            : `IMPORTANT: The user is NOT currently logged in. They should log in to access
    the cloud database backend, sync their data across devices, and customize their
    experience. You can suggest they log in when relevant (e.g., when they ask about
    saving data, accessing the database, or personalizing settings). Use the check_login_status
    function to get current auth details.`,
    }
}
