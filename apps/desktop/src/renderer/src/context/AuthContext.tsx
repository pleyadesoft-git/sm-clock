import React, { createContext, useContext, useState, useEffect } from 'react';
import { agentApi } from '../lib/agent-api';
import { getSupabaseClient } from '../lib/supabase';

export interface UserSession {
  email: string;
  nombre: string;
  rol: 'SUPER_ADMIN' | 'ADMIN_EMPRESA' | 'OPERADOR';
  tenant_id: string | null;
  tenant_nombre?: string;
  isOfflinePin?: boolean;
}

export interface TenantOption {
  id: string;
  nombre: string;
  slug: string;
}

interface AuthContextType {
  user: UserSession | null;
  isLoading: boolean;
  tenants: TenantOption[];
  selectedTenantId: string | null;
  loginWithCredentials: (email: string, pass: string, serverUrl?: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithEmergencyPin: (pin: string) => Promise<void>;
  logout: () => Promise<void>;
  setSelectedTenantId: (tenantId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);

  // Cargar sesión inicial desde SQLite local o Supabase
  useEffect(() => {
    async function checkSession() {
      try {
        const supabase = getSupabaseClient();

        // 0. Si vienen tokens en la URL (retorno del callback de Google OAuth)
        try {
          const currentUrl = new URL(window.location.href);
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
          const accessToken = hashParams.get('access_token') || currentUrl.searchParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token') || currentUrl.searchParams.get('refresh_token');

          if (accessToken && refreshToken) {
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            window.history.replaceState(null, '', window.location.pathname);
          }
        } catch {
          // Continuar con verificación normal si falla el parseo de la URL
        }

        // 1. Probar sesión de Supabase Auth (vital tras redirección de Google OAuth)
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: perfil } = await supabase
            .from('perfiles_usuarios')
            .select('nombre_completo, email, rol, tenant_id')
            .eq('id', session.user.id)
            .maybeSingle();

          const rol = (perfil?.rol || session.user.app_metadata?.['rol'] || 'ADMIN_EMPRESA') as UserSession['rol'];
          const userSession: UserSession = {
            email: session.user.email ?? '',
            nombre: perfil?.nombre_completo ?? (session.user.user_metadata?.['full_name'] as string) ?? 'Administrador',
            rol,
            tenant_id: perfil?.tenant_id ?? (session.user.app_metadata?.['tenant_id'] as string) ?? null,
            isOfflinePin: false,
          };
          setUser(userSession);
          setSelectedTenantIdState(userSession.tenant_id);
          setIsLoading(false);
          return;
        }

        // 2. Probar sesión en el backend local del agente
        const me = await agentApi.getMe();
        if (me.authenticated && me.usuario) {
          setUser({
            email: me.usuario.email,
            nombre: me.usuario.nombre || me.usuario.nombre_completo || 'Administrador',
            rol: me.usuario.rol || 'ADMIN_EMPRESA',
            tenant_id: me.usuario.tenant_id,
            isOfflinePin: me.usuario.email === 'admin_local@smclock.local',
          });
          setSelectedTenantIdState(me.usuario.tenant_id);
        }
      } catch {
        // Motor no disponible aún o sin sesión previa
      } finally {
        setIsLoading(false);
      }
    }
    checkSession();

    // Escuchar eventos de cambio de sesión en Supabase (ej. cuando regresa de Google OAuth)
    const supabase = getSupabaseClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        const { data: perfil } = await supabase
          .from('perfiles_usuarios')
          .select('nombre_completo, email, rol, tenant_id')
          .eq('id', session.user.id)
          .maybeSingle();

        const rol = (perfil?.rol || session.user.app_metadata?.['rol'] || 'ADMIN_EMPRESA') as UserSession['rol'];
        const userSession: UserSession = {
          email: session.user.email ?? '',
          nombre: perfil?.nombre_completo ?? (session.user.user_metadata?.['full_name'] as string) ?? 'Administrador',
          rol,
          tenant_id: perfil?.tenant_id ?? (session.user.app_metadata?.['tenant_id'] as string) ?? null,
          isOfflinePin: false,
        };
        setUser(userSession);
        setSelectedTenantIdState(userSession.tenant_id);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    // Escuchar deep links nativos sm-clock://auth/callback#... desde Electron
    const cleanupDeepLink = window.electronAPI?.onDeepLink?.(async (rawUrl: string) => {
      try {
        const hashIdx = rawUrl.indexOf('#');
        const queryIdx = rawUrl.indexOf('?');
        const hashPart = hashIdx !== -1 ? rawUrl.slice(hashIdx + 1) : '';
        const queryPart =
          queryIdx !== -1
            ? hashIdx !== -1
              ? rawUrl.slice(queryIdx + 1, hashIdx)
              : rawUrl.slice(queryIdx + 1)
            : '';

        const params = new URLSearchParams(hashPart || queryPart);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');

        if (accessToken && refreshToken) {
          const supabaseClient = getSupabaseClient();
          await supabaseClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
        }
      } catch (err) {
        console.error('Error al procesar deep link de autenticación:', err);
      }
    });

    return () => {
      subscription.unsubscribe();
      cleanupDeepLink?.();
    };
  }, []);

  // Si es Super-Admin, cargar lista de tenants disponibles de Supabase
  useEffect(() => {
    async function fetchTenants() {
      if (user?.rol === 'SUPER_ADMIN' && !user.isOfflinePin) {
        try {
          const supabase = getSupabaseClient();
          const { data, error } = await supabase
            .from('tenants')
            .select('id, nombre, slug')
            .order('nombre', { ascending: true });

          if (!error && data) {
            setTenants(data as TenantOption[]);
            if (!selectedTenantId && data.length > 0) {
              const firstTenant = data[0];
              if (firstTenant) {
                setSelectedTenantIdState(firstTenant.id);
              }
            }
          }
        } catch {
          // Ignorar error de red si estamos offline
        }
      }
    }
    fetchTenants();
  }, [user]);

  const loginWithCredentials = async (email: string, pass: string, serverUrl?: string) => {
    setIsLoading(true);
    try {
      // 1. Iniciar sesión en el backend local del agente (que valida contra el SaaS)
      const res = await agentApi.login({
        email,
        password: pass,
        server_url: serverUrl,
      });

      if (!res.ok) {
        throw new Error('Credenciales inválidas');
      }

      // 2. También iniciar sesión en Supabase Auth si es posible para Realtime
      try {
        const supabase = getSupabaseClient(serverUrl);
        await supabase.auth.signInWithPassword({
          email,
          password: pass,
        });
      } catch {
        // Continuar con sesión local si Supabase directo tiene CORS
      }

      const userData: UserSession = {
        email: res.usuario.email,
        nombre: res.usuario.nombre_completo || res.usuario.nombre || 'Administrador',
        rol: res.usuario.rol,
        tenant_id: res.usuario.tenant_id,
        isOfflinePin: false,
      };

      setUser(userData);
      setSelectedTenantIdState(userData.tenant_id);
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setIsLoading(true);
    try {
      const supabase = getSupabaseClient();

      const isLocal =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      // En desarrollo local nos apoyamos en el callback de la app web (puerto 3000),
      // el cual ya está autorizado en la lista de redirección de Supabase.
      const redirectUrl = import.meta.env.NEXT_PUBLIC_AUTH_REDIRECT_URL as string | undefined;
      let webBase =
        (import.meta.env.VITE_WEB_URL as string | undefined) ||
        (import.meta.env.NEXT_PUBLIC_APP_URL as string | undefined);

      if (!webBase && redirectUrl) {
        try {
          webBase = new URL(redirectUrl).origin;
        } catch {
          // ignore
        }
      }

      if (!webBase) {
        webBase = isLocal ? 'http://localhost:3000' : 'https://sm-clock.pleyadesoft.com';
      }

      const isElectronApp = typeof window !== 'undefined' && Boolean(window.electronAPI);
      const targetOrigin = isElectronApp ? 'sm-clock://auth/callback' : window.location.origin;
      const callbackUrl = `${webBase}/api/auth/callback?source=desktop&target=${encodeURIComponent(targetOrigin)}`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl,
          skipBrowserRedirect: isElectronApp,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        throw error;
      }

      if (isElectronApp && data?.url && window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(data.url);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const loginWithEmergencyPin = async (pin: string) => {
    setIsLoading(true);
    try {
      const res = await agentApi.login({ pin_emergencia: pin });
      if (!res.ok) {
        throw new Error('PIN inválido');
      }

      const userData: UserSession = {
        email: 'admin_local@smclock.local',
        nombre: 'Administrador Local (Offline)',
        rol: 'SUPER_ADMIN',
        tenant_id: null,
        isOfflinePin: true,
      };

      setUser(userData);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await agentApi.logout();
      const supabase = getSupabaseClient();
      await supabase.auth.signOut();
    } catch {
      // Ignorar
    } finally {
      setUser(null);
      setSelectedTenantIdState(null);
    }
  };

  const setSelectedTenantId = (tenantId: string) => {
    setSelectedTenantIdState(tenantId);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        tenants,
        selectedTenantId,
        loginWithCredentials,
        loginWithGoogle,
        loginWithEmergencyPin,
        logout,
        setSelectedTenantId,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};
