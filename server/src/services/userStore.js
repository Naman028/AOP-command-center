import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { ROLES } from "../constants/permissions.js";

export function createSeedStore(workFactor = 12) {
  const passwordHash = bcrypt.hashSync("Password123!", workFactor);
  const users = [
    {
      id: "000000000000000000000001",
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
      { id: "PLANT-A", name: "Plant A" },
      { id: "PLANT-B", name: "Plant B" }
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
