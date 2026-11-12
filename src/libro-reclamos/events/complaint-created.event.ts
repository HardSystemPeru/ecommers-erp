// src/complaints/events/complaint-created.event.ts
export class ComplaintCreatedEvent {
  constructor(
    public readonly complaintId: number,
    public readonly numberComplaint: string,
    public readonly email: string,
    public readonly customerName: string,
  ) {}
}
