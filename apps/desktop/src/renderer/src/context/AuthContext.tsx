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
