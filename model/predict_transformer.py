"""Refresh neural next-game predictions using existing trained PyTorch weights.

Run: python -m model.predict_transformer
Then: python -m app_data.build_app_data && python -m app_data.enrich_game_data
No training or network access required. Re-training is needed when historical
statistics/scoring definitions change in a way that affects model calibration.
"""
import json
from model.train_game_logs import OUTPUT, load_logs
from model.train_transformer import latest_windows, load_trained, predict_batches


def main():
    net=load_trained()
    df=load_logs()
    X,M,ids=latest_windows(df)
    scores=predict_batches(net,X,M)
    preds={pid:{'fppg':round(max(0.,float(value)),3),'sequence_length':int(mask.sum())}
           for pid,value,mask in zip(ids,scores,M)}
    OUTPUT.mkdir(parents=True,exist_ok=True)
    (OUTPUT/'transformer_next_game_predictions.json').write_text(json.dumps(preds))
    print(f'Refreshed {len(preds)} neural predictions using the saved model.')

if __name__=='__main__':
    main()
