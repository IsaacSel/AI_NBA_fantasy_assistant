'use client';

import { useEffect, useState } from 'react';
import { Alert, Card, List, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';

type Metrics = {
  model: string; architecture?: string; torch_version?: string;
  target: string; training_seasons: string[]; validation_season?: string;
  test_season: string; training_games: number; validation_games?: number;
  test_games: number; model_mae: number; baseline_last10_mae: number;
  model_rmse: number; best_epoch?: number; sequence_length?: number;
  coverage_note: string; projection_note: string;
  comparison?: {transformer_mae?: number; gradient_boosting_mae: number; baseline_last10_mae?: number};
};

export function ModelView() {
  const [result,setResult] = useState<Metrics|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    fetch('/api/model-metrics').then(async r=>{
      if(!r.ok) throw new Error('Model evaluation unavailable');
      return r.json() as Promise<Metrics>;
    }).then(setResult).catch((e:Error)=>setError(e.message));
  },[]);
  if(error) return <Alert color="red">{error}</Alert>;
  if(!result) return <Loader size="sm" />;
  const comparison=result.comparison;
  return <Stack gap="md">
    <div>
      <Title order={2}>Neural network and game-level AI models</Title>
      <Text c="dimmed">The app uses a previously trained player-sequence Transformer for draft estimates. The original advanced two-team, full-stat architecture is also preserved and accepts your Kaggle data, but requires full training.</Text>
    </div>
    <SimpleGrid cols={{base:1,sm:4}}>
      <Card withBorder><Text c="dimmed" size="sm">Transformer test MAE</Text><Title order={2}>{comparison?.transformer_mae?.toFixed(2) ?? result.model_mae.toFixed(2)} FP</Title></Card>
      <Card withBorder><Text c="dimmed" size="sm">Gradient boosting test MAE</Text><Title order={2}>{comparison?.gradient_boosting_mae.toFixed(2) ?? '—'} FP</Title></Card>
      <Card withBorder><Text c="dimmed" size="sm">Last-10 average test MAE</Text><Title order={2}>{result.baseline_last10_mae.toFixed(2)} FP</Title></Card>
      <Card withBorder><Text c="dimmed" size="sm">Held-out player-games</Text><Title order={2}>{result.test_games.toLocaleString()}</Title></Card>
    </SimpleGrid>
    <Card withBorder>
      <Title order={4} mb="sm">Transformer architecture</Title>
      <List size="sm" spacing="sm">
        <List.Item>PyTorch model: {result.architecture ?? result.model}. Uses multi-head self-attention to learn trends in sequences of previous games.</List.Item>
        <List.Item>Each input has points, rebounds, assists, steals, blocks, shooting, minutes, fantasy points and previous-game context. It never reads the game being predicted.</List.Item>
        <List.Item>Training seasons: {result.training_seasons[0]} to {result.training_seasons[result.training_seasons.length-1]}; validation: {result.validation_season ?? 'not separated'}; untouched test: {result.test_season}.</List.Item>
        <List.Item>The app's draft projection proxy is 70% Transformer next-game prediction and 30% historical-season baseline when enough games are available. The older gradient-boosting model is retained for comparison and fallback.</List.Item>
      </List>
      <Text size="xs" c="dimmed" mt="md">{result.coverage_note}</Text>
      <Text size="xs" c="dimmed" mt="xs">{result.projection_note}</Text>
    </Card>
    <Card withBorder>
      <Title order={4} mb="xs">Original advanced team-aware Transformer — preserved</Title>
      <Text size="sm" mb="sm">The original <code>game_model/run.py</code> still implements 64-dimensional player embeddings, a two-layer recent-form Transformer, a three-layer four-head Transformer that jointly sees both teams, minutes allocation and a full 13-stat-line predictor. It now reads paired Kaggle box scores through <code>game_model/export_data.py</code>.</Text>
      <Text size="sm" mb="sm">Model compatibility and smoke training have been tested, but <strong>the large original architecture has not been fully trained or evaluated in this release.</strong> The metrics above refer to the smaller already-trained player-sequence network, not the original game-level network.</Text>
      <Text size="sm" c="dimmed">To train the original architecture from project root: <code>python game_model/run.py --holdouts 2026</code>. A fully trained checkpoint also enables <code>game_model/predict_matchup.py</code> for hypothetical two-team matchups and full stat lines. No future NBA schedules or active rosters are asserted.</Text>
    </Card>
    <Card withBorder><Title order={4} mb="xs">Important limitations</Title>
      <Text size="sm">A Transformer is a neural network, but it does not guarantee better accuracy than gradient boosting. The uploaded CSVs do not provide future schedules, injuries, opponent-specific predictions or fantasy-platform PG/SG/SF/PF eligibility. Predictions are hypothetical next-game scores used as draft proxies, not validated forecasts of full next-season totals.</Text>
    </Card>
  </Stack>;
}
