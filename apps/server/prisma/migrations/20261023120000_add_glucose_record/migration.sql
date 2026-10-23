-- CreateTable
CREATE TABLE "GlucoseRecord" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "valueMmolL" DECIMAL(4,1) NOT NULL,
    "mealContext" VARCHAR(32),
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlucoseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlucoseRecord_patientId_measuredAt_idx" ON "GlucoseRecord"("patientId", "measuredAt" DESC);

-- AddForeignKey
ALTER TABLE "GlucoseRecord" ADD CONSTRAINT "GlucoseRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
