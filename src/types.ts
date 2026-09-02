export interface CheckIn {
  id: string;
  person: string;
  note?: string;
  mood?: string;
  timestamp: string;
}

export interface MedicationEvent {
  id: string;
  person: string;
  medication: string;
  taken: boolean;
  timestamp: string;
}

export interface CareTask {
  id: string;
  person: string;
  task: string;
  due?: string;
  done: boolean;
  createdAt: string;
}

export interface StoreData {
  checkIns: CheckIn[];
  medicationEvents: MedicationEvent[];
  careTasks: CareTask[];
}
