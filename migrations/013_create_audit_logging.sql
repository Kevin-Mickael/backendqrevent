-- 🛡️ SECURITY AUDIT LOGGING SYSTEM
-- Migration 013: Create comprehensive audit logging infrastructure
-- Critical for compliance and security monitoring

-- Create audit_logs table for tracking sensitive operations
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL, -- login, logout, qr_generate, qr_scan, data_export, etc.
    resource_type VARCHAR(50) NOT NULL, -- user, event, guest, qr_code, etc.
    resource_id UUID, -- ID of the affected resource
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(255),
    details JSONB, -- Store additional context specific to the action
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);

-- Create indexes for efficient audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_id ON audit_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Create login_attempts table for security monitoring
CREATE TABLE IF NOT EXISTS login_attempts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    failure_reason VARCHAR(100), -- invalid_password, user_not_found, rate_limited, etc.
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for login_attempts
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempts_timestamp ON login_attempts(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_success ON login_attempts(success, timestamp DESC);

-- Function to log audit events with automatic context detection
CREATE OR REPLACE FUNCTION log_audit_event(
    p_user_id UUID,
    p_action VARCHAR(50),
    p_resource_type VARCHAR(50),
    p_resource_id UUID DEFAULT NULL,
    p_event_id UUID DEFAULT NULL,
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_session_id VARCHAR(255) DEFAULT NULL,
    p_details JSONB DEFAULT '{}',
    p_severity VARCHAR(20) DEFAULT 'info',
    p_success BOOLEAN DEFAULT TRUE,
    p_error_message TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    audit_id UUID;
BEGIN
    INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id, event_id,
        ip_address, user_agent, session_id, details, severity, success, error_message
    ) VALUES (
        p_user_id, p_action, p_resource_type, p_resource_id, p_event_id,
        p_ip_address, p_user_agent, p_session_id, p_details, p_severity, p_success, p_error_message
    ) RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log login attempts
CREATE OR REPLACE FUNCTION log_login_attempt(
    p_email VARCHAR(255),
    p_ip_address INET,
    p_user_agent TEXT DEFAULT NULL,
    p_success BOOLEAN DEFAULT FALSE,
    p_failure_reason VARCHAR(100) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    attempt_id UUID;
BEGIN
    INSERT INTO login_attempts (email, ip_address, user_agent, success, failure_reason)
    VALUES (p_email, p_ip_address, p_user_agent, p_success, p_failure_reason)
    RETURNING id INTO attempt_id;
    
    RETURN attempt_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get failed login attempts for an IP in last N minutes
CREATE OR REPLACE FUNCTION get_failed_login_attempts(
    p_ip_address INET,
    p_minutes INTEGER DEFAULT 15
)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)
        FROM login_attempts
        WHERE ip_address = p_ip_address
        AND success = FALSE
        AND timestamp > NOW() - INTERVAL '1 minute' * p_minutes
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get failed login attempts for an email in last N minutes
CREATE OR REPLACE FUNCTION get_failed_login_attempts_by_email(
    p_email VARCHAR(255),
    p_minutes INTEGER DEFAULT 15
)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)
        FROM login_attempts
        WHERE LOWER(email) = LOWER(p_email)
        AND success = FALSE
        AND timestamp > NOW() - INTERVAL '1 minute' * p_minutes
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old audit logs (keep last 1 year by default)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs(
    p_retention_days INTEGER DEFAULT 365
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM audit_logs
    WHERE timestamp < NOW() - INTERVAL '1 day' * p_retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Log the cleanup operation
    INSERT INTO audit_logs (user_id, action, resource_type, details, severity)
    VALUES (NULL, 'audit_cleanup', 'system', 
            jsonb_build_object('deleted_count', deleted_count, 'retention_days', p_retention_days),
            'info');
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clean up old login attempts (keep last 30 days by default)
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts(
    p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM login_attempts
    WHERE timestamp < NOW() - INTERVAL '1 day' * p_retention_days;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create RLS policies for audit_logs (only admins and owners can read their own logs)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own audit logs
CREATE POLICY audit_logs_user_access ON audit_logs
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR auth.role() = 'admin');

-- Policy: Only system can insert audit logs
CREATE POLICY audit_logs_system_insert ON audit_logs
    FOR INSERT TO service_role
    WITH CHECK (true);

-- Create RLS policies for login_attempts (only admins can read)
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can read login attempts
CREATE POLICY login_attempts_admin_access ON login_attempts
    FOR SELECT TO authenticated
    USING (auth.role() = 'admin');

-- Policy: Only system can insert login attempts
CREATE POLICY login_attempts_system_insert ON login_attempts
    FOR INSERT TO service_role
    WITH CHECK (true);

-- Create a view for security monitoring dashboard
CREATE OR REPLACE VIEW security_dashboard AS
SELECT 
    'total_users'::text as metric,
    COUNT(*)::bigint as value,
    'info'::text as severity
FROM users
WHERE is_active = true

UNION ALL

SELECT 
    'failed_logins_24h'::text as metric,
    COUNT(*)::bigint as value,
    CASE 
        WHEN COUNT(*) > 100 THEN 'critical'::text
        WHEN COUNT(*) > 50 THEN 'warning'::text
        ELSE 'info'::text
    END as severity
FROM login_attempts
WHERE success = false AND timestamp > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
    'qr_scans_24h'::text as metric,
    COUNT(*)::bigint as value,
    'info'::text as severity
FROM audit_logs
WHERE action = 'qr_scan' AND timestamp > NOW() - INTERVAL '24 hours'

UNION ALL

SELECT 
    'critical_events_24h'::text as metric,
    COUNT(*)::bigint as value,
    CASE 
        WHEN COUNT(*) > 10 THEN 'critical'::text
        WHEN COUNT(*) > 5 THEN 'warning'::text
        ELSE 'info'::text
    END as severity
FROM audit_logs
WHERE severity = 'critical' AND timestamp > NOW() - INTERVAL '24 hours';

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION log_audit_event TO service_role;
GRANT EXECUTE ON FUNCTION log_login_attempt TO service_role;
GRANT EXECUTE ON FUNCTION get_failed_login_attempts TO service_role;
GRANT EXECUTE ON FUNCTION get_failed_login_attempts_by_email TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_audit_logs TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_old_login_attempts TO service_role;
GRANT SELECT ON security_dashboard TO authenticated;

-- Log the successful creation of audit system
INSERT INTO audit_logs (user_id, action, resource_type, details, severity)
VALUES (NULL, 'audit_system_created', 'system', 
        jsonb_build_object('migration', '013_create_audit_logging', 'tables', ARRAY['audit_logs', 'login_attempts']),
        'info');