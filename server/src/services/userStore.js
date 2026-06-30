import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { ROLES } from "../constants/permissions.js";

export function createSeedStore(workFactor = 12) {
  const passwordHash = bcrypt.hashSync("Password123!", workFactor);
  const now = new Date().toISOString();
  const adminId = "000000000000000000000001";
  const users = [
    {
      id: adminId,
      email: "admin@aop.local",
      name: "Admin User",
      passwordHash,
      role: ROLES.ADMIN,
      assignedPlants: ["PLANT-A", "PLANT-B"],
      isActive: true
    },
    {
      id: "000000000000000000000002",
      email: "manager@aop.local",
      name: "Operations Manager",
      passwordHash,
      role: ROLES.MANAGER,
      assignedPlants: ["PLANT-A", "PLANT-B"],
      isActive: true
    },
    {
      id: "000000000000000000000003",
      email: "lead-a@aop.local",
      name: "Team Lead A",
      passwordHash,
      role: ROLES.TEAM_LEAD,
      assignedPlants: ["PLANT-A"],
      isActive: true
    },
    {
      id: "000000000000000000000004",
      email: "staff@aop.local",
      name: "Staff User",
      passwordHash,
      role: ROLES.STAFF,
      assignedPlants: ["PLANT-A"],
      isActive: true
    },
    {
      id: "000000000000000000000005",
      email: "inactive@aop.local",
      name: "Inactive User",
      passwordHash,
      role: ROLES.STAFF,
      assignedPlants: ["PLANT-A"],
      isActive: false
    }
  ];

  return {
    users,
    sessions: [],
    auditLogs: [],
    plants: [
      { id: "100000000000000000000001", name: "Plant A", code: "PLANT-A", location: "North Campus", businessUnit: "Operations", isActive: true, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now },
      { id: "100000000000000000000002", name: "Plant B", code: "PLANT-B", location: "South Campus", businessUnit: "Operations", isActive: true, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now },
      { id: "100000000000000000000003", name: "Inactive Plant", code: "PLANT-Z", location: "Archive", businessUnit: "Operations", isActive: false, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now }
    ],
    materials: [
      { id: "200000000000000000000001", name: "Standard Widget", code: "MAT-A", category: "Finished Goods", unit: "EA", isActive: true, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now },
      { id: "200000000000000000000002", name: "Inactive Material", code: "MAT-Z", category: "Archive", unit: "EA", isActive: false, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now }
    ],
    financialYears: [
      { id: "300000000000000000000001", label: "2026", startDate: "2026-01-01", endDate: "2026-12-31", isActive: true, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now },
      { id: "300000000000000000000002", label: "2025", startDate: "2025-01-01", endDate: "2025-12-31", isActive: false, createdBy: adminId, updatedBy: adminId, createdAt: now, updatedAt: now }
    ],
    targets: [
      { id: uuidv4(), plantId: "PLANT-A", financialYear: "2026", metricType: "output", value: 100 },
      { id: uuidv4(), plantId: "PLANT-B", financialYear: "2026", metricType: "output", value: 200 }
    ],
    actuals: [
      { id: uuidv4(), plantId: "PLANT-A", financialYear: "2026", metricType: "output", period: "2026-01", value: 90 },
      { id: uuidv4(), plantId: "PLANT-B", financialYear: "2026", metricType: "output", period: "2026-01", value: 180 }
    ],
    importBatches: []
  };
}
