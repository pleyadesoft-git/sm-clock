
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agente_codigos_enrolamiento": {
                  Row: {
                    "codigo_hash": string,"created_at": string,"created_by": string | null,"expira_en": string,"id": string,"tenant_id": string,"usado_en": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "codigo_hash": string,"created_at"?: string,"created_by"?: string | null,"expira_en": string,"id"?: string,"tenant_id": string,"usado_en"?: string | null
                  }
                  Update: {
                    "codigo_hash"?: string,"created_at"?: string,"created_by"?: string | null,"expira_en"?: string,"id"?: string,"tenant_id"?: string,"usado_en"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agente_codigos_enrolamiento_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"agente_nonces": {
                  Row: {
                    "agente_id": string,"created_at": string,"expira_en": string,"nonce": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agente_id": string,"created_at"?: string,"expira_en": string,"nonce": string
                  }
                  Update: {
                    "agente_id"?: string,"created_at"?: string,"expira_en"?: string,"nonce"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agente_nonces_agente_id_fkey"
      columns: ["agente_id"]
isOneToOne: false
      referencedRelation: "agentes"
      referencedColumns: ["id"]
    }
                  ]
                },"agentes": {
                  Row: {
                    "created_at": string,"id": string,"nombre": string,"revocado_en": string | null,"tenant_id": string,"token_hash": string,"ultimo_latido": string | null,"version": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"nombre": string,"revocado_en"?: string | null,"tenant_id": string,"token_hash": string,"ultimo_latido"?: string | null,"version"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"nombre"?: string,"revocado_en"?: string | null,"tenant_id"?: string,"token_hash"?: string,"ultimo_latido"?: string | null,"version"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agentes_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"auditoria": {
                  Row: {
                    "accion": string,"actor_id": string | null,"created_at": string,"detalle": Json | null,"id": number,"ip": unknown,"tenant_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accion": string,"actor_id"?: string | null,"created_at"?: string,"detalle"?: Json | null,"id"?: never,"ip"?: unknown,"tenant_id"?: string | null
                  }
                  Update: {
                    "accion"?: string,"actor_id"?: string | null,"created_at"?: string,"detalle"?: Json | null,"id"?: never,"ip"?: unknown,"tenant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "auditoria_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"checadas": {
                  Row: {
                    "agente_id": string | null,"ambigua": boolean,"codigo_empleado": string,"created_at": string,"dentro_geocerca": boolean | null,"distancia_sucursal_m": number | null,"fuente_id": string,"id": number,"latitud": number | null,"longitud": number | null,"precision_m": number | null,"sucursal_id": string | null,"tenant_id": string,"tipo_marca": string,"tipo_verificacion": string | null,"ts_dispositivo_local": string,"ts_utc": string
                  }
                  ComputedFields: never
                  Insert: {
                    "agente_id"?: string | null,"ambigua"?: boolean,"codigo_empleado": string,"created_at"?: string,"dentro_geocerca"?: boolean | null,"distancia_sucursal_m"?: number | null,"fuente_id": string,"id"?: never,"latitud"?: number | null,"longitud"?: number | null,"precision_m"?: number | null,"sucursal_id"?: string | null,"tenant_id": string,"tipo_marca"?: string,"tipo_verificacion"?: string | null,"ts_dispositivo_local": string,"ts_utc": string
                  }
                  Update: {
                    "agente_id"?: string | null,"ambigua"?: boolean,"codigo_empleado"?: string,"created_at"?: string,"dentro_geocerca"?: boolean | null,"distancia_sucursal_m"?: number | null,"fuente_id"?: string,"id"?: never,"latitud"?: number | null,"longitud"?: number | null,"precision_m"?: number | null,"sucursal_id"?: string | null,"tenant_id"?: string,"tipo_marca"?: string,"tipo_verificacion"?: string | null,"ts_dispositivo_local"?: string,"ts_utc"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "checadas_agente_id_fkey"
      columns: ["agente_id"]
isOneToOne: false
      referencedRelation: "agentes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checadas_fuente_id_fkey"
      columns: ["fuente_id"]
isOneToOne: false
      referencedRelation: "fuentes_asistencia"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checadas_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "checadas_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"configuracion_smtp": {
                  Row: {
                    "activo": boolean,"created_at": string,"host": string,"id": string,"puerto": number,"remitente_email": string | null,"remitente_nombre": string,"seguridad": string,"tenant_id": string | null,"tiene_password": boolean,"ultima_prueba_exitosa_en": string | null,"ultimo_error_prueba": string | null,"updated_at": string,"updated_by": string | null,"usar_smtp_propio": boolean,"usuario": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activo"?: boolean,"created_at"?: string,"host"?: string,"id"?: string,"puerto"?: number,"remitente_email"?: string | null,"remitente_nombre"?: string,"seguridad"?: string,"tenant_id"?: string | null,"tiene_password"?: boolean,"ultima_prueba_exitosa_en"?: string | null,"ultimo_error_prueba"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"usar_smtp_propio"?: boolean,"usuario"?: string | null
                  }
                  Update: {
                    "activo"?: boolean,"created_at"?: string,"host"?: string,"id"?: string,"puerto"?: number,"remitente_email"?: string | null,"remitente_nombre"?: string,"seguridad"?: string,"tenant_id"?: string | null,"tiene_password"?: boolean,"ultima_prueba_exitosa_en"?: string | null,"ultimo_error_prueba"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"usar_smtp_propio"?: boolean,"usuario"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "configuracion_smtp_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: true
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"credenciales": {
                  Row: {
                    "ciphertext": string,"id": string,"key_version": number,"nonce": string,"referencia_id": string,"tenant_id": string,"tipo": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ciphertext": string,"id"?: string,"key_version"?: number,"nonce": string,"referencia_id": string,"tenant_id": string,"tipo": string,"updated_at"?: string
                  }
                  Update: {
                    "ciphertext"?: string,"id"?: string,"key_version"?: number,"nonce"?: string,"referencia_id"?: string,"tenant_id"?: string,"tipo"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credenciales_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"empleado_webauthn_credenciales": {
                  Row: {
                    "algoritmo": number,"created_at": string,"credential_id": string,"empleado_id": string,"id": string,"nombre_dispositivo": string,"public_key": string,"sign_count": number,"tenant_id": string,"transports": (string)[],"ultimo_uso_en": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "algoritmo"?: number,"created_at"?: string,"credential_id": string,"empleado_id": string,"id"?: string,"nombre_dispositivo"?: string,"public_key": string,"sign_count"?: number,"tenant_id": string,"transports"?: (string)[],"ultimo_uso_en"?: string | null
                  }
                  Update: {
                    "algoritmo"?: number,"created_at"?: string,"credential_id"?: string,"empleado_id"?: string,"id"?: string,"nombre_dispositivo"?: string,"public_key"?: string,"sign_count"?: number,"tenant_id"?: string,"transports"?: (string)[],"ultimo_uso_en"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "empleado_webauthn_credenciales_empleado_id_fkey"
      columns: ["empleado_id"]
isOneToOne: false
      referencedRelation: "empleados"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "empleado_webauthn_credenciales_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"empleados": {
                  Row: {
                    "biometria_facial_activa": boolean,"codigo_empleado": string,"created_at": string,"credencial": string | null,"departamento": string | null,"email": string | null,"estatus_empleado": string,"foto_actualizada_en": string | null,"foto_path": string | null,"foto_thumb_path": string | null,"id": string,"nombre_completo": string,"pin_codigo": string | null,"puesto": string | null,"sincronizado_en": string,"sucursal_id": string | null,"telefono_whatsapp": string | null,"tenant_id": string,"webauthn_activo": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "biometria_facial_activa"?: boolean,"codigo_empleado": string,"created_at"?: string,"credencial"?: string | null,"departamento"?: string | null,"email"?: string | null,"estatus_empleado"?: string,"foto_actualizada_en"?: string | null,"foto_path"?: string | null,"foto_thumb_path"?: string | null,"id"?: string,"nombre_completo": string,"pin_codigo"?: string | null,"puesto"?: string | null,"sincronizado_en"?: string,"sucursal_id"?: string | null,"telefono_whatsapp"?: string | null,"tenant_id": string,"webauthn_activo"?: boolean
                  }
                  Update: {
                    "biometria_facial_activa"?: boolean,"codigo_empleado"?: string,"created_at"?: string,"credencial"?: string | null,"departamento"?: string | null,"email"?: string | null,"estatus_empleado"?: string,"foto_actualizada_en"?: string | null,"foto_path"?: string | null,"foto_thumb_path"?: string | null,"id"?: string,"nombre_completo"?: string,"pin_codigo"?: string | null,"puesto"?: string | null,"sincronizado_en"?: string,"sucursal_id"?: string | null,"telefono_whatsapp"?: string | null,"tenant_id"?: string,"webauthn_activo"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "empleados_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "empleados_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"fuentes_asistencia": {
                  Row: {
                    "activo": boolean,"clave": string | null,"consecutivo_sucursal": number | null,"created_at": string,"id": string,"intervalo_checadas_min": number,"ip_local": string | null,"marca": string,"modelo": string | null,"nombre_ubicacion": string,"puerto": number | null,"soporta_mensajes_pantalla": boolean,"sucursal_id": string | null,"tacloud_config_exportacion": Json | null,"tacloud_username": string | null,"tenant_id": string,"ultima_conexion_exitosa": string | null,"ultimo_error": string | null,"url_api": string | null,"usuario_dispositivo": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activo"?: boolean,"clave"?: string | null,"consecutivo_sucursal"?: number | null,"created_at"?: string,"id"?: string,"intervalo_checadas_min"?: number,"ip_local"?: string | null,"marca": string,"modelo"?: string | null,"nombre_ubicacion": string,"puerto"?: number | null,"soporta_mensajes_pantalla"?: boolean,"sucursal_id"?: string | null,"tacloud_config_exportacion"?: Json | null,"tacloud_username"?: string | null,"tenant_id": string,"ultima_conexion_exitosa"?: string | null,"ultimo_error"?: string | null,"url_api"?: string | null,"usuario_dispositivo"?: string | null
                  }
                  Update: {
                    "activo"?: boolean,"clave"?: string | null,"consecutivo_sucursal"?: number | null,"created_at"?: string,"id"?: string,"intervalo_checadas_min"?: number,"ip_local"?: string | null,"marca"?: string,"modelo"?: string | null,"nombre_ubicacion"?: string,"puerto"?: number | null,"soporta_mensajes_pantalla"?: boolean,"sucursal_id"?: string | null,"tacloud_config_exportacion"?: Json | null,"tacloud_username"?: string | null,"tenant_id"?: string,"ultima_conexion_exitosa"?: string | null,"ultimo_error"?: string | null,"url_api"?: string | null,"usuario_dispositivo"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fuentes_asistencia_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fuentes_asistencia_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"invitaciones_usuarios": {
                  Row: {
                    "aceptada_en": string | null,"created_at": string,"email": string,"estatus": string,"expira_en": string,"id": string,"invitado_por": string | null,"nombre_completo": string,"rol": string,"sucursal_id": string | null,"tenant_id": string,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "aceptada_en"?: string | null,"created_at"?: string,"email": string,"estatus"?: string,"expira_en": string,"id"?: string,"invitado_por"?: string | null,"nombre_completo": string,"rol": string,"sucursal_id"?: string | null,"tenant_id": string,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "aceptada_en"?: string | null,"created_at"?: string,"email"?: string,"estatus"?: string,"expira_en"?: string,"id"?: string,"invitado_por"?: string | null,"nombre_completo"?: string,"rol"?: string,"sucursal_id"?: string | null,"tenant_id"?: string,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitaciones_usuarios_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invitaciones_usuarios_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"mensajes_checadas": {
                  Row: {
                    "activo": boolean,"alcance": string,"creado_por": string | null,"created_at": string,"departamento": string | null,"empleado_id": string | null,"evento_disparo": string,"id": string,"mensaje": string,"modo_entrega": string,"repeticion": string,"reproducir_audio": boolean,"sucursal_id": string | null,"tenant_id": string,"texto_voz_personalizado": string | null,"titulo": string,"updated_at": string,"vigente_hasta": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "activo"?: boolean,"alcance"?: string,"creado_por"?: string | null,"created_at"?: string,"departamento"?: string | null,"empleado_id"?: string | null,"evento_disparo"?: string,"id"?: string,"mensaje": string,"modo_entrega"?: string,"repeticion"?: string,"reproducir_audio"?: boolean,"sucursal_id"?: string | null,"tenant_id": string,"texto_voz_personalizado"?: string | null,"titulo": string,"updated_at"?: string,"vigente_hasta"?: string | null
                  }
                  Update: {
                    "activo"?: boolean,"alcance"?: string,"creado_por"?: string | null,"created_at"?: string,"departamento"?: string | null,"empleado_id"?: string | null,"evento_disparo"?: string,"id"?: string,"mensaje"?: string,"modo_entrega"?: string,"repeticion"?: string,"reproducir_audio"?: boolean,"sucursal_id"?: string | null,"tenant_id"?: string,"texto_voz_personalizado"?: string | null,"titulo"?: string,"updated_at"?: string,"vigente_hasta"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "mensajes_checadas_empleado_id_fkey"
      columns: ["empleado_id"]
isOneToOne: false
      referencedRelation: "empleados"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensajes_checadas_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensajes_checadas_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"mensajes_checadas_entregas": {
                  Row: {
                    "canal_utilizado": string,"checada_id": number | null,"codigo_empleado": string,"detalle": string | null,"dispositivo_soportaba": boolean,"email_destino": string | null,"empleado_id": string,"entregado_en": string,"estatus_entrega": string,"id": string,"mensaje_id": string,"telefono_whatsapp": string | null,"tenant_id": string,"tipo_marca": string,"whatsapp_web_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "canal_utilizado": string,"checada_id"?: number | null,"codigo_empleado": string,"detalle"?: string | null,"dispositivo_soportaba"?: boolean,"email_destino"?: string | null,"empleado_id": string,"entregado_en"?: string,"estatus_entrega": string,"id"?: string,"mensaje_id": string,"telefono_whatsapp"?: string | null,"tenant_id": string,"tipo_marca"?: string,"whatsapp_web_url"?: string | null
                  }
                  Update: {
                    "canal_utilizado"?: string,"checada_id"?: number | null,"codigo_empleado"?: string,"detalle"?: string | null,"dispositivo_soportaba"?: boolean,"email_destino"?: string | null,"empleado_id"?: string,"entregado_en"?: string,"estatus_entrega"?: string,"id"?: string,"mensaje_id"?: string,"telefono_whatsapp"?: string | null,"tenant_id"?: string,"tipo_marca"?: string,"whatsapp_web_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "mensajes_checadas_entregas_checada_id_fkey"
      columns: ["checada_id"]
isOneToOne: false
      referencedRelation: "checadas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensajes_checadas_entregas_empleado_id_fkey"
      columns: ["empleado_id"]
isOneToOne: false
      referencedRelation: "empleados"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensajes_checadas_entregas_mensaje_id_fkey"
      columns: ["mensaje_id"]
isOneToOne: false
      referencedRelation: "mensajes_checadas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mensajes_checadas_entregas_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"perfiles_usuarios": {
                  Row: {
                    "activo": boolean,"auth_provider": string,"created_at": string,"deleted_at": string | null,"email": string,"id": string,"nombre_completo": string,"rol": string,"sucursal_id": string | null,"tenant_id": string | null,"ultimo_acceso_en": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activo"?: boolean,"auth_provider"?: string,"created_at"?: string,"deleted_at"?: string | null,"email": string,"id": string,"nombre_completo": string,"rol": string,"sucursal_id"?: string | null,"tenant_id"?: string | null,"ultimo_acceso_en"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "activo"?: boolean,"auth_provider"?: string,"created_at"?: string,"deleted_at"?: string | null,"email"?: string,"id"?: string,"nombre_completo"?: string,"rol"?: string,"sucursal_id"?: string | null,"tenant_id"?: string | null,"ultimo_acceso_en"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "perfiles_usuarios_sucursal_id_fkey"
      columns: ["sucursal_id"]
isOneToOne: false
      referencedRelation: "sucursales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "perfiles_usuarios_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"sucursales": {
                  Row: {
                    "activa": boolean,"clave": string,"created_at": string,"direccion": string | null,"id": string,"latitud": number | null,"longitud": number | null,"nombre": string,"radio_geocerca_m": number,"tenant_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activa"?: boolean,"clave": string,"created_at"?: string,"direccion"?: string | null,"id"?: string,"latitud"?: number | null,"longitud"?: number | null,"nombre": string,"radio_geocerca_m"?: number,"tenant_id": string
                  }
                  Update: {
                    "activa"?: boolean,"clave"?: string,"created_at"?: string,"direccion"?: string | null,"id"?: string,"latitud"?: number | null,"longitud"?: number | null,"nombre"?: string,"radio_geocerca_m"?: number,"tenant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sucursales_tenant_id_fkey"
      columns: ["tenant_id"]
isOneToOne: false
      referencedRelation: "tenants"
      referencedColumns: ["id"]
    }
                  ]
                },"tenants": {
                  Row: {
                    "codigo_postal_fiscal": string,"contacto_email": string | null,"contacto_nombre": string | null,"contacto_telefono": string | null,"correo_facturacion": string | null,"created_at": string,"deleted_at": string | null,"estatus": string,"id": string,"logo_url": string | null,"nombre_comercial": string,"notas_internas": string | null,"plan_codigo": string,"razon_social": string,"regimen_fiscal": string,"rfc": string,"tenant_code": string,"updated_at": string,"uso_cfdi": string,"zona_horaria": string
                  }
                  ComputedFields: never
                  Insert: {
                    "codigo_postal_fiscal": string,"contacto_email"?: string | null,"contacto_nombre"?: string | null,"contacto_telefono"?: string | null,"correo_facturacion"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"estatus"?: string,"id"?: string,"logo_url"?: string | null,"nombre_comercial": string,"notas_internas"?: string | null,"plan_codigo"?: string,"razon_social": string,"regimen_fiscal": string,"rfc": string,"tenant_code": string,"updated_at"?: string,"uso_cfdi"?: string,"zona_horaria"?: string
                  }
                  Update: {
                    "codigo_postal_fiscal"?: string,"contacto_email"?: string | null,"contacto_nombre"?: string | null,"contacto_telefono"?: string | null,"correo_facturacion"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"estatus"?: string,"id"?: string,"logo_url"?: string | null,"nombre_comercial"?: string,"notas_internas"?: string | null,"plan_codigo"?: string,"razon_social"?: string,"regimen_fiscal"?: string,"rfc"?: string,"tenant_code"?: string,"updated_at"?: string,"uso_cfdi"?: string,"zona_horaria"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "current_tenant_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"current_user_rol":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"custom_access_token_hook":
{ Args: { "event": Json }; Returns: Json
                           },
"generar_nomenclatura_fuente":
{ Args: { "p_sucursal_id": string,"p_tenant_id": string }; Returns: {
              "clave": string,"consecutivo": number
            }[]
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
