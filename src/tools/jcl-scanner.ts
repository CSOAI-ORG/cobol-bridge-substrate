import { z } from 'zod';

const JclScannerSchema = z.object({
  jcl: z.string().min(1).describe('JCL job stream source code'),
  options: z.object({
    detectDatasets: z.boolean().optional().default(true),
    analyzePrograms: z.boolean().optional().default(true),
    mapDependencies: z.boolean().optional().default(true)
  }).optional()
});

function parseJcl(jcl: string): any {
  const lines = jcl.split('\n');
  const steps: any[] = [];
  const datasets: any[] = [];
  const programs: any[] = [];
  const dependencies: any[] = [];

  let currentJob: string | null = null;
  let currentStep: any = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Parse JOB statement
    if (trimmed.startsWith('//') && trimmed.includes('JOB')) {
      const match = trimmed.match(/\/\/(\S+)\s+JOB/);
      if (match) {
        currentJob = match[1];
      }
    }

    // Parse EXEC statement
    if (trimmed.startsWith('//') && trimmed.includes('EXEC')) {
      const stepMatch = trimmed.match(/\/\/(\S+)\s+EXEC\s+(\S+)/);
      if (stepMatch) {
        currentStep = {
          name: stepMatch[1],
          program: stepMatch[2],
          datasets: [],
          condition: null
        };
        steps.push(currentStep);

        if (!programs.includes(stepMatch[2])) {
          programs.push(stepMatch[2]);
        }
      }

      // Parse PGM parameter
      const pgmMatch = trimmed.match(/PGM=(\S+)/);
      if (pgmMatch && currentStep) {
        currentStep.program = pgmMatch[1];
      }

      // Parse PROC parameter
      const procMatch = trimmed.match(/PROC=(\S+)/);
      if (procMatch) {
        dependencies.push({
          type: 'PROCEDURE',
          name: procMatch[1],
          step: currentStep?.name
        });
      }
    }

    // Parse DD statement
    if (trimmed.startsWith('//') && trimmed.includes('DD')) {
      const ddMatch = trimmed.match(/\/\/(\S+)\s+DD\s+(.+)/);
      if (ddMatch) {
        const ddName = ddMatch[1];
        const ddParams = ddMatch[2];

        const dataset: any = {
          ddName,
          parameters: ddParams
        };

        // Extract dataset name
        const dsnMatch = ddParams.match(/DSN=(\S+)/i);
        if (dsnMatch) {
          dataset.name = dsnMatch[1];
          datasets.push(dataset);
          if (currentStep) {
            currentStep.datasets.push(dataset);
          }
        }

        // Extract disposition
        const dispMatch = ddParams.match(/DISP=\(([^)]+)\)/);
        if (dispMatch) {
          dataset.disposition = dispMatch[1].split(',').map((d: string) => d.trim());
        }
      }
    }

    // Parse conditional execution
    if (trimmed.includes('COND=')) {
      const condMatch = trimmed.match(/COND=\(([^)]+)\)/);
      if (condMatch && currentStep) {
        currentStep.condition = condMatch[1];
      }
    }
  }

  return { job: currentJob, steps, datasets, programs, dependencies };
}

function analyzeGovernance(parsed: any): any {
  const findings: any[] = [];

  // Check for sensitive datasets
  const sensitivePatterns = ['PROD', 'PRODUCTION', 'CUSTOMER', 'PAYROLL', 'FINANCIAL'];
  parsed.datasets.forEach((ds: any) => {
    if (ds.name && sensitivePatterns.some(p => ds.name.toUpperCase().includes(p))) {
      findings.push({
        type: 'SENSITIVE_DATA',
        severity: 'HIGH',
        dataset: ds.name,
        description: 'Dataset may contain sensitive production data',
        recommendation: 'Verify data masking and access controls'
      });
    }
  });

  // Check for external references
  parsed.dependencies.forEach((dep: any) => {
    findings.push({
      type: 'EXTERNAL_DEPENDENCY',
      severity: 'MEDIUM',
      dependency: dep,
      description: 'External procedure or program reference',
      recommendation: 'Document and monitor external dependencies'
    });
  });

  return findings;
}

export const jclBatchScanner = {
  name: 'jcl-batch-scanner',
  description: 'Scan JCL job streams for data lineage, dataset detection, and governance compliance mapping',
  schema: JclScannerSchema.shape,
  handler: async (args: z.infer<typeof JclScannerSchema>) => {
    try {
      const startTime = Date.now();
      const parsed = parseJcl(args.jcl);
      const governanceFindings = analyzeGovernance(parsed);
      const duration = Date.now() - startTime;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            job: parsed.job,
            summary: {
              totalSteps: parsed.steps.length,
              totalDatasets: parsed.datasets.length,
              uniquePrograms: parsed.programs.length,
              externalDependencies: parsed.dependencies.length,
              governanceFindings: governanceFindings.length
            },
            steps: parsed.steps,
            datasets: parsed.datasets,
            programs: parsed.programs,
            dependencies: parsed.dependencies,
            governance: governanceFindings,
            dataLineage: {
              flows: parsed.steps.map((step: any) => ({
                step: step.name,
                program: step.program,
                inputs: step.datasets.filter((ds: any) => 
                  ds.disposition?.includes('OLD') || ds.disposition?.includes('SHR')
                ),
                outputs: step.datasets.filter((ds: any) => 
                  ds.disposition?.includes('NEW') || ds.disposition?.includes('MOD')
                )
              }))
            },
            performance: {
              duration: `${duration}ms`,
              timestamp: new Date().toISOString()
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }],
        isError: true
      };
    }
  }
};
