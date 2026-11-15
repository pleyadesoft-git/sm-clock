import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form';
import { Input } from './input';

const TestSchema = z.object({
  nombre: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
});

type TestInput = z.infer<typeof TestSchema>;

function TestFormComponent({ onSubmitSpy }: { onSubmitSpy?: (data: TestInput) => void }) {
  const form = useForm<TestInput>({
    resolver: zodResolver(TestSchema),
    defaultValues: {
      nombre: '',
    },
    mode: 'onTouched',
  });

  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={form.handleSubmit((data) => onSubmitSpy?.(data))}
      >
        <FormField
          control={form.control}
          name="nombre"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input placeholder="Ingresa nombre" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Enviar</button>
      </form>
    </Form>
  );
}

describe('Form Validation Component (Rule 12)', () => {
  it('does NOT display error or aria-invalid="true" when form is clean/pristine', () => {
    render(<TestFormComponent />);
    const input = screen.getByPlaceholderText('Ingresa nombre');
    const label = screen.getByText('Nombre');

    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(label.className).not.toContain('text-[var(--danger)]');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('displays aria-invalid="true" and error message once input is dirty and invalid', async () => {
    render(<TestFormComponent />);
    const input = screen.getByPlaceholderText('Ingresa nombre');

    // Change input value to invalid length and blur to trigger onTouched / isDirty
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('El nombre debe tener al menos 3 caracteres')).toBeDefined();
    });
  });

  it('displays aria-invalid="true" and error message upon submitting empty required field', async () => {
    render(<TestFormComponent />);
    const input = screen.getByPlaceholderText('Ingresa nombre');
    const submitBtn = screen.getByText('Enviar');

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText('El nombre debe tener al menos 3 caracteres')).toBeDefined();
    });
  });
});
