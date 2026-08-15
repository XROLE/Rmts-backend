import 'dotenv/config';
import { supabase } from '../config/supabase.js';
import { HttpError } from '../middleware/errorHandler.js';
import { emailService } from './email.service.js';
import type { CreateSupportTicketInput } from '../schemas/support.schema.js';

export class SupportService {
  /**
   * Persists a support ticket and notifies the support inbox by email.
   * A failure to send the email does not fail the request; the ticket is
   * still stored and returned.
   */
  async create(userId: string, userEmail: string | undefined, input: CreateSupportTicketInput) {
    const { data: ticket, error: insertError } = await supabase
      .from('support_tickets')
      .insert({
        user_id: userId,
        title: input.title,
        message: input.message,
      })
      .select('id, user_id, title, message, status, created_at')
      .single();

    if (insertError || !ticket) {
      throw new HttpError(
        500,
        `Failed to store support ticket: ${insertError?.message ?? 'unknown error'}`,
      );
    }

    try {
      await emailService.sendSupportTicket({
        title: ticket.title,
        message: ticket.message,
        userId: ticket.user_id,
        userEmail,
      });

      await supabase
        .from('support_tickets')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('id', ticket.id);
    } catch (err) {
      console.error('Failed to email support ticket:', err);
    }

    return ticket;
  }
}

export const supportService = new SupportService();
