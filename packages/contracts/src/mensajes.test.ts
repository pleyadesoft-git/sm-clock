import { describe, expect, it } from 'vitest';
import {
  buildPersonalizedVoiceText,
  buildWhatsAppWebUrl,
  MensajeChecadaCreateSchema,
  PLANTILLAS_MENSAJES_RH,
} from './mensajes';

describe('Mensajes al empleado en Check-In / Check-Out (@sm-clock/contracts)', () => {
  it('valida un aviso individual para un empleado con audio dinámico personalizado', () => {
    const res = MensajeChecadaCreateSchema.safeParse({
      titulo: 'Firma de contrato en RH',
      mensaje: 'Pasar a RH a firmar contrato',
      texto_voz_personalizado:
        'Hola {nombre}, favor de pasar a Recursos Humanos a firmar tu contrato.',
      reproducir_audio: true,
      alcance: 'EMPLEADO',
      empleado_id: '550e8400-e29b-41d4-a716-446655440000',
      evento_disparo: 'ENTRADA',
      modo_entrega: 'AUTO_FALLBACK',
      repeticion: 'UNA_VEZ',
    });

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.alcance).toBe('EMPLEADO');
      expect(res.data.reproducir_audio).toBe(true);
    }
  });

  it('exige empleado_id cuando alcance es EMPLEADO y sucursal_id cuando alcance es SUCURSAL', () => {
    const missingEmp = MensajeChecadaCreateSchema.safeParse({
      titulo: 'Firma de contrato',
      mensaje: 'Pasar a RH a firmar contrato',
      alcance: 'EMPLEADO',
    });
    expect(missingEmp.success).toBe(false);

    const missingSuc = MensajeChecadaCreateSchema.safeParse({
      titulo: 'Entrega de credencial',
      mensaje: 'Favor de pasar a Administración',
      alcance: 'SUCURSAL',
    });
    expect(missingSuc.success).toBe(false);

    const validMasivoTodos = MensajeChecadaCreateSchema.safeParse({
      titulo: 'Aviso General de Planta',
      mensaje: 'Favor de pasar a Administración para entrega de credencial',
      alcance: 'TODOS',
      evento_disparo: 'SALIDA',
    });
    expect(validMasivoTodos.success).toBe(true);
  });

  it('construye la frase de voz dinámica personalizada reemplazando variables', () => {
    const text = buildPersonalizedVoiceText({
      template:
        'Hola {nombre} (#{codigo}), al {evento} tienes un aviso: {mensaje}',
      nombreEmpleado: 'Alejandro Hernández Soto',
      codigoEmpleado: '1001',
      titulo: 'Firma de contrato',
      mensaje: 'Pasar a RH a firmar contrato',
      tipoMarca: 'ENTRADA',
    });

    expect(text).toBe(
      'Hola Alejandro Hernández (#1001), al registrar tu entrada tienes un aviso: Pasar a RH a firmar contrato',
    );
  });

  it('genera URL de WhatsApp Web (wa.me) con código de país 52 para números de 10 dígitos', () => {
    const url = buildWhatsAppWebUrl({
      telefonoWhatsapp: '6641234567',
      nombreEmpleado: 'Alejandro Hernández',
      tenantNombre: 'Maquiladora del Pacífico',
      titulo: 'Entrega de credencial',
      mensaje: 'Favor de pasar a la Administración para entrega de credencial',
      tipoMarca: 'SALIDA',
    });

    expect(url).not.toBeNull();
    expect(url).toContain('https://wa.me/526641234567?text=');
    expect(decodeURIComponent(url ?? '')).toContain(
      'Favor de pasar a la Administración para entrega de credencial',
    );
  });

  it('incluye plantillas predefinidas de Recursos Humanos listas para usar', () => {
    expect(PLANTILLAS_MENSAJES_RH.length).toBeGreaterThanOrEqual(5);
    expect(PLANTILLAS_MENSAJES_RH[0]?.mensaje).toContain(
      'Pasar a RH a firmar contrato',
    );
  });
});
